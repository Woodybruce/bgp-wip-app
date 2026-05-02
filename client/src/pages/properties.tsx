import { legacyToCode, DEAL_STATUS_LABELS } from "@shared/deal-status";
import { guessDomain } from "@/lib/company-logos";
import { useTeam } from "@/lib/team-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ScrollableTable } from "@/components/scrollable-table";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { PageLayout } from "@/components/page-layout";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
import {
  Search,
  Users,
  Building2,
  AlertCircle,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  X,
  ArrowLeft,
  FolderTree,
  Loader2,
  CheckCircle2,
  FolderOpen,
  ChevronRight,
  Handshake,
  FileText,
  Clock,
  Plus,
  Pencil,
  Trash2,
  Save,
  MapPin,
  SlidersHorizontal,
  Eye,
  EyeOff,
  Globe,
  Newspaper,
  RefreshCw,
  Brain,
  Zap,
  Droplets,
  Landmark,
  Train,
  TrendingUp,
  ShieldAlert,
  FileDown,
  ShieldCheck,
  XCircle,
  Circle,
  UserCheck,
  Copy,
  FileSearch,
  Check,
  Sparkles,
  MessageSquare,
  Image as ImageIcon,
  Camera,
  Bookmark,
  BookmarkCheck,
  Link2,
} from "lucide-react";
import { useState, useMemo, useEffect, useCallback } from "react";
import { PropertyLeasingSchedule } from "@/pages/leasing-schedule";
import { PropertyTenancySchedule } from "@/components/PropertyTenancySchedule";
import { trackRecentItem } from "@/hooks/use-recent-items";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useRoute, Link } from "wouter";
import { apiRequest, queryClient, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { InlineText, InlineSelect, InlineLabelSelect, InlineNumber, InlineMultiSelect } from "@/components/inline-edit";
import { buildUserColorMap } from "@/lib/agent-colors";
import { AddressAutocomplete, InlineAddress, buildGoogleMapsUrl } from "@/components/address-autocomplete";
import { ColumnFilterPopover } from "@/components/column-filter-popover";
import { CRM_OPTIONS } from "@/lib/crm-options";
import { MobileCardView, ViewToggle, type MobileCardItem } from "@/components/mobile-card-view";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { PropertyDetail } from "@/components/property-detail";
import type { CrmProperty, CrmDeal, CrmContact, CrmCompany, CrmLead, User } from "@shared/schema";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
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
import { EmptyState } from "@/components/empty-state";

const GROUP_TABS = [
  { id: "all", label: "All" },
  { id: "Properties", label: "Properties" },
  { id: "Pipeline", label: "Pipeline" },
  { id: "Archived", label: "Archived" },
  { id: "Development", label: "Development" },
  { id: "Investment Comps", label: "Investment Comps" },
];

const HIDDEN_FROM_ALL = new Set(["Investment Comps", "Investment Comp"]);

export const STATUS_OPTIONS = ["BGP Active", "BGP Targeting", "Leasing Instruction", "Lease Advisory Instruction", "Sales Instruction", "Archive"];

function extractDomainForLogo(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = raw.startsWith("http") ? raw : `https://${raw}`;
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    const cleaned = raw.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
    return cleaned || null;
  }
}

export function CompanyLogoImg({ domain, name, size = 40 }: { domain: string | null | undefined; name: string | null | undefined; size?: number }) {
  const [failCount, setFailCount] = useState(0);

  const d = extractDomainForLogo(domain);
  const guessedDomain = guessDomain(name);

  const logoSources: string[] = [];
  if (d) {
    logoSources.push(`https://logo.clearbit.com/${d}?size=${Math.min(size * 3, 512)}`);
  }
  if (guessedDomain && guessedDomain !== d) {
    logoSources.push(`https://logo.clearbit.com/${guessedDomain}?size=${Math.min(size * 3, 512)}`);
  }

  if (failCount >= logoSources.length) {
    const initials = (name || "?").split(/\s+/).map(w => w[0]).join("").toUpperCase().slice(0, 2);
    return (
      <div
        className="rounded-lg bg-muted flex items-center justify-center shrink-0 text-xs font-bold text-muted-foreground"
        style={{ width: size, height: size }}
        data-testid="company-logo-fallback"
      >
        {initials}
      </div>
    );
  }

  return (
    <img
      src={logoSources[failCount]}
      alt={name || "Company logo"}
      loading="lazy"
      decoding="async"
      className="rounded-lg shrink-0 object-contain bg-white border"
      style={{ width: size, height: size }}
      onError={() => setFailCount(c => c + 1)}
      data-testid="company-logo"
    />
  );
}

export const PROPERTY_STATUS_COLORS: Record<string, string> = {
  "BGP Active": "bg-emerald-500",
  "BGP Targeting": "bg-amber-500",
  "Leasing Instruction": "bg-blue-500",
  "Lease Advisory Instruction": "bg-violet-500",
  "Sales Instruction": "bg-emerald-600",
  "Archive": "bg-zinc-400",
};

const BUILDING_ICON_COLORS: Record<string, string> = {
  "BGP Active": "text-emerald-500",
  "BGP Targeting": "text-amber-500",
  "Leasing Instruction": "text-blue-500",
  "Lease Advisory Instruction": "text-violet-500",
  "Sales Instruction": "text-emerald-600",
  "Archive": "text-zinc-400",
};
export const ASSET_CLASS_OPTIONS = ["Retail", "Office", "Industrial", "Mixed Use", "F&B", "Leisure", "Residential"];

export const ASSET_CLASS_COLORS: Record<string, string> = {
  "Retail": "bg-blue-500",
  "Office": "bg-violet-500",
  "Industrial": "bg-amber-500",
  "Mixed Use": "bg-teal-500",
  "F&B": "bg-rose-500",
  "Leisure": "bg-emerald-500",
  "Residential": "bg-sky-500",
};
export const TENURE_OPTIONS = ["Freehold", "Leasehold", "Virtual Freehold"];

export const TENURE_COLORS: Record<string, string> = {
  "Freehold": "bg-indigo-500",
  "Leasehold": "bg-orange-500",
  "Virtual Freehold": "bg-cyan-500",
};
export const TEAM_OPTIONS = CRM_OPTIONS.dealTeam;

export const TEAM_COLORS: Record<string, string> = {
  "Investment": "bg-sky-600",
  "London F&B": "bg-rose-500",
  "London Retail": "bg-teal-500",
  "National Leasing": "bg-violet-500",
  "Lease Advisory": "bg-indigo-500",
  "Tenant Rep": "bg-pink-500",
  "Development": "bg-orange-500",
  "Office / Corporate": "bg-slate-500",
  "Landsec": "bg-amber-500",
};

export function InlineEngagement({
  value,
  options,
  colorMap,
  onSave,
  placeholder = "Set team",
}: {
  value: string[] | string | null;
  options: string[];
  colorMap: Record<string, string>;
  onSave: (val: string[]) => void;
  placeholder?: string;
}) {
  const current: string[] = Array.isArray(value) ? value : value ? [value] : [];

  const toggle = (option: string) => {
    const next = current.includes(option)
      ? current.filter(v => v !== option)
      : [...current, option];
    onSave(next);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="flex items-center gap-1 flex-wrap min-h-[20px]" data-testid="inline-engagement-trigger">
          {current.length === 0 ? (
            <span className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
              <Plus className="w-3 h-3" />
              {placeholder}
            </span>
          ) : (
            current.map(v => (
              <Badge key={v} className={`text-[10px] px-1.5 py-0 text-white ${colorMap[v] || "bg-gray-500"}`}>
                {v}
              </Badge>
            ))
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {options.map(option => (
          <DropdownMenuItem
            key={option}
            onClick={() => toggle(option)}
            data-testid={`engagement-option-${option}`}
          >
            <div className={`w-3 h-3 rounded-sm border mr-2 flex items-center justify-center ${current.includes(option) ? colorMap[option] || "bg-gray-500" : "border-muted-foreground/30"}`}>
              {current.includes(option) && <span className="text-white text-[8px]">✓</span>}
            </div>
            <Badge className={`text-[10px] px-1.5 py-0 text-white ${colorMap[option] || "bg-gray-500"}`}>
              {option}
            </Badge>
          </DropdownMenuItem>
        ))}
        {current.length > 0 && (
          <DropdownMenuItem onClick={() => onSave([])} data-testid="engagement-clear-all">
            <X className="w-3 h-3 mr-2 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Clear all</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function InlineFolderTree({
  propertyId,
  propertyName,
  folderTeams,
}: {
  propertyId: string;
  propertyName: string;
  folderTeams: string[] | null;
}) {
  const current = folderTeams || [];
  const { toast } = useToast();
  const [creating, setCreating] = useState<string | null>(null);

  const createFoldersMutation = useMutation({
    mutationFn: async (team: string) => {
      setCreating(team);
      const res = await apiRequest("POST", "/api/microsoft/property-folders", {
        propertyName,
        team,
      });
      return res.json();
    },
    onSuccess: (data, team) => {
      const updated = [...current, team];
      apiRequest("PUT", `/api/crm/properties/${propertyId}`, { folderTeams: updated });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/properties"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/properties", propertyId] });
      toast({
        title: "Folders Created",
        description: `${data.created} folders created for ${propertyName} under ${team}`,
      });
      setCreating(null);
    },
    onError: (err: any) => {
      toast({
        title: "Error",
        description: err.message || "Failed to create folders",
        variant: "destructive",
      });
      setCreating(null);
    },
  });

  const handleToggle = (team: string) => {
    if (current.includes(team)) return;
    createFoldersMutation.mutate(team);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="flex items-center gap-1 flex-wrap min-h-[20px]" data-testid="inline-folder-tree-trigger">
          {current.length === 0 ? (
            <span className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
              <FolderTree className="w-3 h-3" />
              Set up folders
            </span>
          ) : (
            <div className="flex items-center gap-1 flex-wrap">
              {current.map(t => (
                <Badge key={t} variant="outline" className="text-[10px] px-1.5 py-0 gap-1">
                  <FolderOpen className="w-2.5 h-2.5" />
                  {t}
                </Badge>
              ))}
            </div>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Create folder tree for team</div>
        {TEAMS.map(team => {
          const isCreated = current.includes(team);
          const isCreating = creating === team;
          return (
            <DropdownMenuItem
              key={team}
              onClick={() => !isCreated && !isCreating && handleToggle(team)}
              disabled={isCreated || isCreating}
              data-testid={`folder-team-option-${team.toLowerCase().replace(/[\s\/]/g, "-")}`}
            >
              <div className={`w-3 h-3 rounded-sm border mr-2 flex items-center justify-center ${isCreated ? "bg-green-500 border-green-500" : "border-muted-foreground/30"}`}>
                {isCreated && <span className="text-white text-[8px]">✓</span>}
              </div>
              <span className="text-xs flex-1">{team}</span>
              {isCreating && <Loader2 className="w-3 h-3 animate-spin ml-1" />}
              {isCreated && <CheckCircle2 className="w-3 h-3 text-green-500 ml-1" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function addressToResult(address: any): { formatted: string; placeId: string; lat?: number; lng?: number } | null {
  if (!address) return null;
  if (typeof address === "string") return { formatted: address, placeId: "" };
  const formatted = address.address || address.text || [address.street, address.city, address.country].filter(Boolean).join(", ");
  if (!formatted) return null;
  return {
    formatted,
    placeId: address.placeId || "",
    lat: address.lat ? parseFloat(address.lat) : undefined,
    lng: address.lng ? parseFloat(address.lng) : undefined,
  };
}

export function resultToAddress(result: { formatted: string; placeId: string; lat?: number; lng?: number; street?: string; city?: string; region?: string; postcode?: string; country?: string } | null): any {
  if (!result) return null;
  return {
    address: result.formatted,
    placeId: result.placeId,
    lat: result.lat,
    lng: result.lng,
    street: result.street || undefined,
    city: result.city || undefined,
    region: result.region || undefined,
    postcode: result.postcode || undefined,
    country: result.country || undefined,
  };
}

export function formatAddress(address: any): string {
  if (!address) return "";
  if (typeof address === "string") return address;
  if (address.address) return address.address;
  if (address.formatted) return address.formatted;
  if (address.text) return address.text;
  const parts = [address.street, address.city, address.country].filter(Boolean);
  return parts.join(", ");
}

function getInitials(name: string): string {
  return name.split(" ").map(p => p[0]).join("").toUpperCase().slice(0, 2);
}

export function InlineAgents({
  propertyId,
  agentLinks,
  allUsers,
  colorMap,
}: {
  propertyId: string;
  agentLinks: { propertyId: string; userId: string }[];
  allUsers: User[];
  colorMap?: Record<string, string>;
}) {
  const { toast } = useToast();
  const assignedUserIds = agentLinks.filter(l => l.propertyId === propertyId).map(l => l.userId);
  const assignedUsers = allUsers.filter(u => assignedUserIds.includes(String(u.id)));
  const unassignedUsers = allUsers.filter(u => !assignedUserIds.includes(String(u.id)));

  const addMutation = useMutation({
    mutationFn: async (userId: string) => {
      await apiRequest("POST", `/api/crm/properties/${propertyId}/agents`, { userId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/property-agents"] });
    },
    onError: (err: any) => {
      toast({ title: "Failed to assign agent", description: err.message, variant: "destructive" });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (userId: string) => {
      await apiRequest("DELETE", `/api/crm/properties/${propertyId}/agents/${userId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/property-agents"] });
    },
    onError: (err: any) => {
      toast({ title: "Failed to remove agent", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {assignedUsers.map(user => {
        const bg = colorMap?.[user.name] || "bg-zinc-500";
        return (
        <span key={user.id} className="inline-flex items-center gap-0.5">
          <Badge
            className={`text-[10px] px-1.5 py-0 text-white ${bg}`}
            data-testid={`agent-badge-${propertyId}-${user.id}`}
          >
            {user.name.split(" ")[0]}
          </Badge>
          <button
            className="w-3.5 h-3.5 rounded-full hover:bg-destructive/20 flex items-center justify-center"
            onClick={() => removeMutation.mutate(String(user.id))}
            data-testid={`remove-agent-${propertyId}-${user.id}`}
          >
            <X className="w-2.5 h-2.5 text-muted-foreground hover:text-destructive" />
          </button>
        </span>
        );
      })}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="w-5 h-5 rounded-full border border-dashed border-muted-foreground/40 flex items-center justify-center hover:border-primary hover:bg-muted transition-colors"
            data-testid={`add-agent-${propertyId}`}
          >
            <Plus className="w-3 h-3 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-60 overflow-y-auto">
          {unassignedUsers.length === 0 ? (
            <DropdownMenuItem disabled>All team members assigned</DropdownMenuItem>
          ) : (
            unassignedUsers.map(user => (
              <DropdownMenuItem
                key={user.id}
                onClick={() => addMutation.mutate(String(user.id))}
                data-testid={`assign-agent-${user.id}`}
              >
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-medium text-white mr-2 ${colorMap?.[user.name] || "bg-primary/10 text-primary"}`}>
                  {getInitials(user.name)}
                </div>
                {user.name}
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function InlineLandlord({
  propertyId,
  landlordId,
  allCompanies,
}: {
  propertyId: string;
  landlordId: string | null;
  allCompanies: CrmCompany[];
}) {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const landlord = landlordId ? allCompanies.find(c => c.id === landlordId) : null;
  const filteredCompanies = searchTerm
    ? allCompanies.filter(c => c.name.toLowerCase().includes(searchTerm.toLowerCase())).slice(0, 20)
    : allCompanies.slice(0, 20);

  const updateMutation = useMutation({
    mutationFn: async (companyId: string | null) => {
      await apiRequest("PUT", `/api/crm/properties/${propertyId}`, { landlordId: companyId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/properties"] });
    },
    onError: (err: any) => {
      toast({ title: "Failed to update landlord", description: err.message, variant: "destructive" });
    },
  });

  const parentCompany = landlord?.parentCompanyId
    ? allCompanies.find(c => c.id === landlord.parentCompanyId)
    : null;

  const discoverParentMutation = useMutation({
    mutationFn: async () => {
      if (!landlordId) return;
      const res = await apiRequest("POST", `/api/companies-house/discover-parent/${landlordId}`);
      return res.json();
    },
    onSuccess: (data: any) => {
      if (data?.parentFound) {
        queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
        queryClient.invalidateQueries({ queryKey: ["/api/crm/properties"] });
        toast({ title: "Parent company identified", description: data.parentCompany?.name });
      } else {
        toast({ title: "No parent company found", description: "This may not be an SPV" });
      }
    },
    onError: (err: any) => {
      toast({ title: "Parent discovery failed", description: err.message, variant: "destructive" });
    },
  });

  if (landlord) {
    return (
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-1">
          <Link href={`/companies/${landlord.id}`}>
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 cursor-pointer hover:bg-muted"
              data-testid={`landlord-badge-${propertyId}`}
            >
              <Building2 className="w-2.5 h-2.5 mr-0.5 text-muted-foreground" />
              {landlord.name}
            </Badge>
          </Link>
          <button
            className="w-3.5 h-3.5 rounded-full hover:bg-destructive/20 flex items-center justify-center"
            onClick={() => updateMutation.mutate(null)}
            data-testid={`remove-landlord-${propertyId}`}
          >
            <X className="w-2.5 h-2.5 text-muted-foreground hover:text-destructive" />
          </button>
        </div>
        {parentCompany ? (
          <div className="flex items-center gap-1 ml-3">
            <span className="text-[9px] text-muted-foreground">Parent:</span>
            <Link href={`/companies/${parentCompany.id}`}>
              <Badge
                variant="secondary"
                className="text-[10px] px-1.5 py-0 cursor-pointer hover:bg-accent bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800"
                data-testid={`parent-badge-${propertyId}`}
              >
                <Building2 className="w-2.5 h-2.5 mr-0.5" />
                {parentCompany.name}
              </Badge>
            </Link>
          </div>
        ) : landlord.companiesHouseNumber && !landlord.parentCompanyId ? (
          <button
            className="ml-3 text-[9px] text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200 flex items-center gap-0.5 transition-colors"
            onClick={() => discoverParentMutation.mutate()}
            disabled={discoverParentMutation.isPending}
            data-testid={`discover-parent-${propertyId}`}
          >
            {discoverParentMutation.isPending ? (
              <Loader2 className="w-2.5 h-2.5 animate-spin" />
            ) : (
              <Search className="w-2.5 h-2.5" />
            )}
            {discoverParentMutation.isPending ? "Discovering..." : "Discover parent company"}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
          data-testid={`set-landlord-${propertyId}`}
        >
          <Plus className="w-3 h-3" />
          Set landlord
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <div className="p-2">
          <Input
            placeholder="Search companies..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="h-7 text-xs"
            data-testid={`search-landlord-${propertyId}`}
          />
        </div>
        <div className="max-h-48 overflow-y-auto">
          {filteredCompanies.length === 0 ? (
            <DropdownMenuItem disabled>No companies found</DropdownMenuItem>
          ) : (
            filteredCompanies.map(company => (
              <DropdownMenuItem
                key={company.id}
                onClick={() => { updateMutation.mutate(company.id); setSearchTerm(""); }}
                data-testid={`assign-landlord-${company.id}`}
              >
                <Building2 className="w-3.5 h-3.5 mr-2 text-muted-foreground" />
                <span className="truncate">{company.name}</span>
              </DropdownMenuItem>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Generic ownership-stack link — reusable for freeholder, long leaseholder,
// senior lender, junior lender fields.
export function InlineOwnerLink({
  propertyId,
  companyId,
  fieldName,
  label,
  allCompanies,
}: {
  propertyId: string;
  companyId: string | null | undefined;
  fieldName: string;
  label: string;
  allCompanies: CrmCompany[];
}) {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const company = companyId ? allCompanies.find(c => c.id === companyId) : null;
  const filtered = searchTerm
    ? allCompanies.filter(c => c.name.toLowerCase().includes(searchTerm.toLowerCase())).slice(0, 20)
    : allCompanies.slice(0, 20);

  const updateMutation = useMutation({
    mutationFn: async (val: string | null) => {
      await apiRequest("PUT", `/api/crm/properties/${propertyId}`, { [fieldName]: val });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/crm/properties"] }),
    onError: (err: any) => toast({ title: `Failed to update ${label}`, description: err.message, variant: "destructive" }),
  });

  if (company) {
    return (
      <div className="flex items-center gap-1">
        <Link href={`/companies/${company.id}`}>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 cursor-pointer hover:bg-muted">
            <Building2 className="w-2.5 h-2.5 mr-0.5 text-muted-foreground" />
            {company.name}
          </Badge>
        </Link>
        <button
          className="w-3.5 h-3.5 rounded-full hover:bg-destructive/20 flex items-center justify-center"
          onClick={() => updateMutation.mutate(null)}
        >
          <X className="w-2.5 h-2.5 text-muted-foreground hover:text-destructive" />
        </button>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
          <Plus className="w-3 h-3" />
          {label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <div className="p-2">
          <Input
            placeholder="Search companies..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="h-7 text-xs"
          />
        </div>
        <div className="max-h-48 overflow-y-auto">
          {filtered.length === 0 ? (
            <DropdownMenuItem disabled>No companies found</DropdownMenuItem>
          ) : (
            filtered.map(co => (
              <DropdownMenuItem
                key={co.id}
                onClick={() => { updateMutation.mutate(co.id); setSearchTerm(""); }}
              >
                <Building2 className="w-3.5 h-3.5 mr-2 text-muted-foreground" />
                <span className="truncate">{co.name}</span>
              </DropdownMenuItem>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function InlineBillingEntity({
  propertyId,
  billingEntityId,
  landlordId,
  allCompanies,
}: {
  propertyId: string;
  billingEntityId: string | null;
  landlordId: string | null;
  allCompanies: CrmCompany[];
}) {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const billingEntity = billingEntityId ? allCompanies.find(c => c.id === billingEntityId) : null;
  const landlord = landlordId ? allCompanies.find(c => c.id === landlordId) : null;
  const filteredCompanies = searchTerm
    ? allCompanies.filter(c => c.name.toLowerCase().includes(searchTerm.toLowerCase())).slice(0, 20)
    : allCompanies.slice(0, 20);

  const updateMutation = useMutation({
    mutationFn: async (companyId: string | null) => {
      await apiRequest("PUT", `/api/crm/properties/${propertyId}`, { billingEntityId: companyId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/properties"] });
      toast({ title: "Billing entity updated" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to update billing entity", description: err.message, variant: "destructive" });
    },
  });

  // Auto-suggest: if landlord is a Billing Entity type, offer to set it
  const landlordIsBillingEntity = landlord?.companyType === "Billing Entity";

  if (billingEntity) {
    return (
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-1">
          <Link href={`/companies/${billingEntity.id}`}>
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 cursor-pointer hover:bg-muted border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300"
            >
              <FileText className="w-2.5 h-2.5 mr-0.5" />
              {billingEntity.name}
            </Badge>
          </Link>
          <button
            className="w-3.5 h-3.5 rounded-full hover:bg-destructive/20 flex items-center justify-center"
            onClick={() => updateMutation.mutate(null)}
          >
            <X className="w-2.5 h-2.5 text-muted-foreground hover:text-destructive" />
          </button>
        </div>
        <span className="text-[9px] text-muted-foreground ml-1">Invoice to this entity</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      {landlordIsBillingEntity && !billingEntityId && (
        <button
          className="text-[9px] text-amber-600 hover:text-amber-800 dark:text-amber-400 flex items-center gap-0.5 mb-0.5"
          onClick={() => updateMutation.mutate(landlordId)}
        >
          <FileText className="w-2.5 h-2.5" />
          Use landlord as billing entity
        </button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
            <Plus className="w-3 h-3" />
            Set billing entity
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <div className="px-2 pt-2 pb-1">
            <p className="text-[10px] text-muted-foreground mb-1">The SPV or legal entity used for invoicing</p>
            <Input
              placeholder="Search companies..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-7 text-xs"
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filteredCompanies.length === 0 ? (
              <DropdownMenuItem disabled>No companies found</DropdownMenuItem>
            ) : (
              filteredCompanies.map(company => (
                <DropdownMenuItem
                  key={company.id}
                  onClick={() => { updateMutation.mutate(company.id); setSearchTerm(""); }}
                >
                  <FileText className="w-3.5 h-3.5 mr-2 text-muted-foreground" />
                  <span className="truncate">{company.name}</span>
                  {company.companyType === "Billing Entity" && (
                    <Badge variant="secondary" className="ml-auto text-[8px] px-1">SPV</Badge>
                  )}
                </DropdownMenuItem>
              ))
            )}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export type DealLink = { id: string; name: string; propertyId: string | null; status: string | null; groupName: string | null };

export function InlineDeals({
  propertyId,
  dealLinks,
  allDeals,
}: {
  propertyId: string;
  dealLinks: DealLink[];
  allDeals: DealLink[];
}) {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const linkedDeals = dealLinks.filter(d => d.propertyId === propertyId);
  const unlinkedDeals = allDeals.filter(d => !d.propertyId || d.propertyId === propertyId);
  const filteredDeals = searchTerm
    ? unlinkedDeals.filter(d => !linkedDeals.some(l => l.id === d.id) && d.name.toLowerCase().includes(searchTerm.toLowerCase())).slice(0, 20)
    : unlinkedDeals.filter(d => !linkedDeals.some(l => l.id === d.id)).slice(0, 20);

  const linkMutation = useMutation({
    mutationFn: async (dealId: string) => {
      await apiRequest("PUT", `/api/crm/deals/${dealId}`, { propertyId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/property-deal-links"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/deals"] });
    },
    onError: (err: any) => {
      toast({ title: "Failed to link deal", description: err.message, variant: "destructive" });
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: async (dealId: string) => {
      await apiRequest("PUT", `/api/crm/deals/${dealId}`, { propertyId: null });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/property-deal-links"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/deals"] });
    },
    onError: (err: any) => {
      toast({ title: "Failed to unlink deal", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {linkedDeals.map(deal => (
        <div key={deal.id} className="flex items-center gap-0.5">
          <Link href={`/deals/${deal.id}`}>
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 cursor-pointer hover:bg-muted"
              data-testid={`deal-badge-${deal.id}`}
            >
              <Handshake className="w-2.5 h-2.5 mr-0.5 text-muted-foreground" />
              {deal.name}
            </Badge>
          </Link>
          <button
            className="w-3.5 h-3.5 rounded-full hover:bg-destructive/20 flex items-center justify-center"
            onClick={() => unlinkMutation.mutate(deal.id)}
            data-testid={`remove-deal-${deal.id}`}
          >
            <X className="w-2.5 h-2.5 text-muted-foreground hover:text-destructive" />
          </button>
        </div>
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="w-5 h-5 rounded-full border border-dashed border-muted-foreground/30 hover:border-foreground/50 flex items-center justify-center transition-colors"
            data-testid={`add-deal-${propertyId}`}
          >
            <Plus className="w-3 h-3 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <div className="p-2">
            <Input
              placeholder="Search deals..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-7 text-xs"
              data-testid={`search-deal-${propertyId}`}
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filteredDeals.length === 0 ? (
              <DropdownMenuItem disabled>No deals found</DropdownMenuItem>
            ) : (
              filteredDeals.map(deal => (
                <DropdownMenuItem
                  key={deal.id}
                  onClick={() => { linkMutation.mutate(deal.id); setSearchTerm(""); }}
                  data-testid={`assign-deal-${deal.id}`}
                >
                  <Handshake className="w-3.5 h-3.5 mr-2 text-muted-foreground" />
                  <span className="truncate">{deal.name}</span>
                </DropdownMenuItem>
              ))
            )}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function InlineTenants({
  propertyId,
  tenantLinks,
  allCompanies,
}: {
  propertyId: string;
  tenantLinks: { propertyId: string; companyId: string }[];
  allCompanies: CrmCompany[];
}) {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const assignedCompanyIds = tenantLinks.filter(l => l.propertyId === propertyId).map(l => l.companyId);
  const assignedCompanies = allCompanies.filter(c => assignedCompanyIds.includes(c.id));
  const unassignedCompanies = allCompanies.filter(c => !assignedCompanyIds.includes(c.id));
  const filteredUnassigned = searchTerm
    ? unassignedCompanies.filter(c => c.name.toLowerCase().includes(searchTerm.toLowerCase()))
    : unassignedCompanies.slice(0, 20);

  const addMutation = useMutation({
    mutationFn: async (companyId: string) => {
      await apiRequest("POST", `/api/crm/properties/${propertyId}/tenants`, { companyId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/property-tenants"] });
    },
    onError: (err: any) => {
      toast({ title: "Failed to add tenant", description: err.message, variant: "destructive" });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (companyId: string) => {
      await apiRequest("DELETE", `/api/crm/properties/${propertyId}/tenants/${companyId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/property-tenants"] });
    },
    onError: (err: any) => {
      toast({ title: "Failed to remove tenant", description: err.message, variant: "destructive" });
    },
  });

  const MAX_VISIBLE = 3;
  const visibleCompanies = assignedCompanies.slice(0, MAX_VISIBLE);
  const hiddenCount = assignedCompanies.length - MAX_VISIBLE;

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {visibleCompanies.map(company => (
        <span key={company.id} className="inline-flex items-center gap-0.5">
          <Link href={`/companies/${company.id}`}>
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 cursor-pointer hover:bg-muted group"
              data-testid={`tenant-badge-${propertyId}-${company.id}`}
            >
              <Building2 className="w-2.5 h-2.5 mr-0.5 text-muted-foreground" />
              {company.name}
            </Badge>
          </Link>
          <button
            className="w-3.5 h-3.5 rounded-full hover:bg-destructive/20 flex items-center justify-center"
            onClick={() => removeMutation.mutate(company.id)}
            data-testid={`remove-tenant-${propertyId}-${company.id}`}
          >
            <X className="w-2.5 h-2.5 text-muted-foreground hover:text-destructive" />
          </button>
        </span>
      ))}
      {hiddenCount > 0 && (
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">+{hiddenCount} more</Badge>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="w-5 h-5 rounded-full border border-dashed border-muted-foreground/40 flex items-center justify-center hover:border-primary hover:bg-muted transition-colors"
            data-testid={`add-tenant-${propertyId}`}
          >
            <Plus className="w-3 h-3 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <div className="p-2">
            <Input
              placeholder="Search companies..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-7 text-xs"
              data-testid={`search-tenant-${propertyId}`}
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filteredUnassigned.length === 0 ? (
              <DropdownMenuItem disabled>No companies found</DropdownMenuItem>
            ) : (
              filteredUnassigned.map(company => (
                <DropdownMenuItem
                  key={company.id}
                  onClick={() => { addMutation.mutate(company.id); setSearchTerm(""); }}
                  data-testid={`assign-tenant-${company.id}`}
                >
                  <Building2 className="w-3.5 h-3.5 mr-2 text-muted-foreground" />
                  <span className="truncate">{company.name}</span>
                </DropdownMenuItem>
              ))
            )}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// ColumnFilterPopover imported from shared component

const TEAMS = CRM_OPTIONS.dealTeam;

interface FolderTemplate {
  team: string;
  folderCount: number;
  structure: string[];
}

function buildTreeFromPaths(paths: string[]): { name: string; children: any[] }[] {
  const root: any[] = [];
  for (const p of paths) {
    const parts = p.split("/");
    let current = root;
    for (const part of parts) {
      let existing = current.find((n: any) => n.name === part);
      if (!existing) {
        existing = { name: part, children: [] };
        current.push(existing);
      }
      current = existing.children;
    }
  }
  return root;
}

function TreeNode({ node, depth = 0 }: { node: { name: string; children: any[] }; depth?: number }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 py-0.5" style={{ paddingLeft: `${depth * 16}px` }}>
        {node.children.length > 0 ? (
          <FolderOpen className="w-3.5 h-3.5 text-muted-foreground" />
        ) : (
          <FolderOpen className="w-3.5 h-3.5 text-muted-foreground/50" />
        )}
        <span className="text-xs">{node.name}</span>
      </div>
      {node.children.map((child: any) => (
        <TreeNode key={child.name} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

export function SetUpFoldersDialog({
  propertyId,
  propertyName,
  folderTeams,
  open,
  onOpenChange,
}: {
  propertyId: string;
  propertyName: string;
  folderTeams?: string[] | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const { toast } = useToast();

  const { data: currentUser } = useQuery<any>({
    queryKey: ["/api/auth/me"],
  });

  const { data: templates } = useQuery<FolderTemplate[]>({
    queryKey: ["/api/microsoft/folder-templates"],
    enabled: open,
  });

  const { data: msStatus } = useQuery<any>({
    queryKey: ["/api/microsoft/status"],
    enabled: open,
  });

  const defaultTeam = currentUser?.team || null;
  const activeTeam = selectedTeam || defaultTeam;

  const activeTemplate = templates?.find((t) => t.team === activeTeam);
  const treeNodes = activeTemplate ? buildTreeFromPaths(activeTemplate.structure) : [];

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!activeTeam) throw new Error("Please select a team");
      const res = await apiRequest("POST", "/api/microsoft/property-folders", {
        propertyName,
        team: activeTeam,
      });
      return res.json();
    },
    onSuccess: async (data) => {
      setResult(data);
      const currentTeams = folderTeams || [];
      if (!currentTeams.includes(data.team)) {
        const updated = [...currentTeams, data.team];
        await apiRequest("PUT", `/api/crm/properties/${propertyId}`, { folderTeams: updated });
        queryClient.invalidateQueries({ queryKey: ["/api/crm/properties"] });
        queryClient.invalidateQueries({ queryKey: ["/api/crm/properties", propertyId] });
      }
      toast({
        title: "Folders Created",
        description: `${data.created} folders created for ${propertyName} under ${data.team}`,
      });
    },
    onError: (err: any) => {
      toast({
        title: "Error",
        description: err.message || "Failed to create folders",
        variant: "destructive",
      });
    },
  });

  const handleClose = () => {
    setResult(null);
    setSelectedTeam(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg" data-testid="dialog-setup-folders">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderTree className="w-5 h-5" />
            Set Up Property Folders
          </DialogTitle>
          <DialogDescription>
            Create a SharePoint folder structure for <span className="font-medium text-foreground">{propertyName}</span>
          </DialogDescription>
        </DialogHeader>

        {!msStatus?.connected ? (
          <div className="py-6 text-center space-y-2">
            <AlertCircle className="w-8 h-8 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Please connect to Microsoft 365 first via the SharePoint page</p>
          </div>
        ) : result ? (
          <div className="space-y-4" data-testid="folder-creation-result">
            <div className="flex items-center gap-3 p-4 bg-green-50 dark:bg-green-950/30 rounded-lg">
              <CheckCircle2 className="w-6 h-6 text-green-600 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium">Folders created successfully</p>
                <p className="text-xs text-muted-foreground">
                  {result.created} folders under {result.team}/{propertyName}
                </p>
              </div>
            </div>
            {result.errors > 0 && (
              <p className="text-xs text-amber-600">{result.errors} folders had errors (may already exist)</p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={handleClose} data-testid="button-close-folder-result">
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Which team should this property be filed under?</p>
              <div className="grid grid-cols-2 gap-2">
                {TEAMS.map((team) => (
                  <button
                    key={team}
                    className={`text-left px-3 py-2 rounded-md border text-xs transition-colors ${
                      activeTeam === team
                        ? "border-black dark:border-white bg-black dark:bg-white text-white dark:text-black"
                        : "border-border hover-elevate"
                    }`}
                    onClick={() => setSelectedTeam(team)}
                    data-testid={`button-team-${team.toLowerCase().replace(/[\s\/]/g, "-")}`}
                  >
                    <span className="font-medium">{team}</span>
                    {team === defaultTeam && !selectedTeam && (
                      <span className="ml-1 text-[10px] opacity-70">(your team)</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {activeTeam && activeTemplate && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    Folder structure preview ({activeTemplate.folderCount} folders)
                  </p>
                </div>
                <div className="border rounded-md p-3 bg-muted/30 max-h-[250px] overflow-y-auto">
                  <div className="flex items-center gap-1.5 py-0.5 font-medium">
                    <FolderOpen className="w-3.5 h-3.5" />
                    <span className="text-xs">{activeTeam}</span>
                    <ChevronRight className="w-3 h-3 text-muted-foreground" />
                    <span className="text-xs">{propertyName}</span>
                  </div>
                  {treeNodes.map((node) => (
                    <TreeNode key={node.name} node={node} depth={1} />
                  ))}
                </div>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={handleClose} data-testid="button-cancel-folders">
                Cancel
              </Button>
              <Button
                onClick={() => createMutation.mutate()}
                disabled={!activeTeam || createMutation.isPending}
                data-testid="button-create-folders"
              >
                {createMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <FolderTree className="w-4 h-4 mr-2" />
                    Create Folders
                  </>
                )}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface PropertyFolderItem {
  id: string;
  name: string;
  isFolder: boolean;
  childCount: number;
  size: number;
  webUrl: string;
  lastModified: string;
}

export function PropertyFoldersPanel({ propertyName, folderTeams, sharepointFolderUrl }: { propertyName: string; folderTeams?: string[] | null; sharepointFolderUrl?: string | null }) {
  const { data: currentUser } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const userTeam = currentUser?.team || "Investment";
  const teamsToCheck = folderTeams && folderTeams.length > 0 ? folderTeams : [userTeam];
  const [activeTeamName, setActiveTeamName] = useState<string | null>(null);
  const activeTeam = activeTeamName && teamsToCheck.includes(activeTeamName) ? activeTeamName : teamsToCheck[0] || userTeam;
  const activeTeamIdx = teamsToCheck.indexOf(activeTeam);

  // If the CRM record has a stored SharePoint folder URL, prefer that — it
  // resolves to the real folder regardless of name mismatches between CRM
  // and SharePoint. The team-based path synthesis is only used as a fallback.
  const folderUrl = (sharepointFolderUrl || "").trim();

  const { data: folderData, isLoading } = useQuery<{ exists: boolean; folders: PropertyFolderItem[]; path?: string; webUrl?: string; source?: string }>({
    queryKey: ["/api/microsoft/property-folders", activeTeam, propertyName, folderUrl],
    queryFn: async () => {
      const qs = folderUrl ? `?folderUrl=${encodeURIComponent(folderUrl)}` : "";
      const res = await fetch(`/api/microsoft/property-folders/${encodeURIComponent(activeTeam)}/${encodeURIComponent(propertyName)}${qs}`, { credentials: "include" });
      if (!res.ok) {
        if (res.status === 401) return { exists: false, folders: [] };
        throw new Error("Failed to load folders");
      }
      return res.json();
    },
    retry: false,
  });

  if (isLoading) {
    return (
      <Card data-testid="property-folders-panel">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <FolderOpen className="w-4 h-4" />
            <h3 className="text-sm font-semibold">Folders</h3>
          </div>
          <div className="space-y-2">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-8" />)}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="property-folders-panel">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <FolderOpen className="w-4 h-4" />
            <h3 className="text-sm font-semibold">Folders</h3>
            {teamsToCheck.map((t, idx) => (
              <Badge
                key={t}
                variant={idx === activeTeamIdx ? "default" : "outline"}
                className={`text-[10px] cursor-pointer ${idx === activeTeamIdx ? "" : "opacity-60"}`}
                onClick={() => setActiveTeamName(t)}
                data-testid={`folder-team-tab-${t}`}
              >
                {t}
              </Badge>
            ))}
          </div>
        </div>

        {!folderData?.exists ? (
          <div className="text-center py-6">
            <FolderTree className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
            <p className="text-xs text-muted-foreground">No folders set up yet</p>
            <p className="text-[10px] text-muted-foreground mt-1">Use "Set Up Folders" to create a folder structure</p>
          </div>
        ) : (
          <div className="space-y-1">
            {folderData.folders.filter(f => f.isFolder).map((folder) => (
              <a
                key={folder.id}
                href={folder.webUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-2 py-1.5 rounded-md hover-elevate transition-colors group"
                data-testid={`folder-item-${folder.id}`}
              >
                <FolderOpen className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                <span className="text-xs flex-1 truncate">{folder.name}</span>
                {folder.childCount > 0 && (
                  <span className="text-[10px] text-muted-foreground">{folder.childCount}</span>
                )}
                <ExternalLink className="w-3 h-3 text-muted-foreground invisible group-hover:visible flex-shrink-0" />
              </a>
            ))}
            {folderData.folders.filter(f => !f.isFolder).map((file) => (
              <a
                key={file.id}
                href={file.webUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-2 py-1.5 rounded-md hover-elevate transition-colors group"
                data-testid={`file-item-${file.id}`}
              >
                <FileText className="w-3.5 h-3.5 text-muted-foreground/60 flex-shrink-0" />
                <span className="text-xs flex-1 truncate">{file.name}</span>
                <ExternalLink className="w-3 h-3 text-muted-foreground invisible group-hover:visible flex-shrink-0" />
              </a>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function PropertySharepointLink({
  propertyId,
  sharepointFolderUrl,
  onUpdate,
}: {
  propertyId: string;
  sharepointFolderUrl?: string | null;
  onUpdate: (field: string, value: any) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [urlInput, setUrlInput] = useState(sharepointFolderUrl || "");

  if (sharepointFolderUrl && !editing) {
    return (
      <div className="flex items-center gap-2 pt-1">
        <a
          href={sharepointFolderUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-primary hover:underline"
          data-testid="link-property-sharepoint-url"
        >
          <ExternalLink className="w-3 h-3" />
          Open in SharePoint
        </a>
        <button
          className="text-muted-foreground hover:text-foreground"
          onClick={() => { setUrlInput(sharepointFolderUrl); setEditing(true); }}
          data-testid="button-edit-property-sharepoint-url"
        >
          <Pencil className="w-3 h-3" />
        </button>
      </div>
    );
  }

  if (editing) {
    return (
      <div className="space-y-2 pt-1">
        <Input
          placeholder="https://brucegillinghampollard.sharepoint.com/..."
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          className="text-xs h-8"
          data-testid="input-property-sharepoint-url"
        />
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="h-7 text-xs"
            onClick={() => {
              onUpdate("sharepointFolderUrl", urlInput.trim() || null);
              setEditing(false);
            }}
            disabled={!urlInput.trim()}
            data-testid="button-save-property-sharepoint-url"
          >
            Save
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setEditing(false)}
          >
            Cancel
          </Button>
          {sharepointFolderUrl && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-destructive hover:text-destructive"
              onClick={() => {
                onUpdate("sharepointFolderUrl", null);
                setEditing(false);
                setUrlInput("");
              }}
              data-testid="button-remove-property-sharepoint-url"
            >
              Remove
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="text-xs h-7 mt-1"
      onClick={() => setEditing(true)}
      data-testid="button-link-property-sharepoint"
    >
      <Link2 className="w-3 h-3 mr-1" />
      Link SharePoint Folder
    </Button>
  );
}

export function LinkedDealsPanel({ propertyId }: { propertyId: string }) {
  const { data: deals, isLoading } = useQuery<CrmDeal[]>({
    queryKey: ["/api/crm/properties", propertyId, "deals"],
    queryFn: async () => {
      const res = await fetch(`/api/crm/properties/${propertyId}/deals`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load linked deals");
      return res.json();
    },
  });

  const dealsList = deals || [];

  if (isLoading) {
    return (
      <Card data-testid="linked-deals-panel">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Handshake className="w-4 h-4" />
            <h3 className="text-sm font-semibold">Linked Deals</h3>
          </div>
          <div className="space-y-2">
            {[1, 2].map((i) => <Skeleton key={i} className="h-14" />)}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="linked-deals-panel">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Handshake className="w-4 h-4" />
            <h3 className="text-sm font-semibold">Linked Deals</h3>
            {dealsList.length > 0 && (
              <Badge variant="secondary" className="text-[10px]">{dealsList.length}</Badge>
            )}
          </div>
        </div>

        {dealsList.length === 0 ? (
          <div className="text-center py-6">
            <Handshake className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
            <p className="text-xs text-muted-foreground">No deals linked to this property</p>
          </div>
        ) : (
          <div className="space-y-2">
            {dealsList.map((deal) => (
              <Link
                key={deal.id}
                href={`/deals/${deal.id}`}
              >
                <div
                  className="block p-3 rounded-md border hover-elevate transition-colors group cursor-pointer"
                  data-testid={`deal-item-${deal.id}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium truncate">{deal.name}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    {deal.groupName && (
                      <Badge variant="secondary" className="text-[10px]">
                        {deal.groupName}
                      </Badge>
                    )}
                    {deal.status && (
                      <Badge variant="outline" className="text-[10px]">{deal.status}</Badge>
                    )}
                    {deal.team && (
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        {deal.team}
                      </span>
                    )}
                    {deal.updatedAt && (
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(deal.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const CLIENT_ROLE_OPTIONS = [
  "Landlord Contact",
  "Asset Manager",
  "Property Manager",
  "Surveyor",
  "Legal",
  "Accounts",
  "Director",
  "Consultant",
  "Other",
];

export function ClientBoardPanel({ propertyId, landlordId, allCompanies }: { propertyId: string; landlordId: string | null; allCompanies: CrmCompany[] }) {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [editingRole, setEditingRole] = useState<string | null>(null);

  const landlord = landlordId ? allCompanies.find(c => c.id === landlordId) : null;

  const { data: clients = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/crm/properties", propertyId, "clients"],
    queryFn: async () => {
      const res = await fetch(`/api/crm/properties/${propertyId}/clients`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: allContacts = [] } = useQuery<CrmContact[]>({
    queryKey: ["/api/crm/contacts"],
    enabled: showSearch,
  });

  const filteredContacts = useMemo(() => {
    if (!searchTerm.trim()) return [];
    const existing = new Set(clients.map((c: any) => c.contactId));
    return allContacts
      .filter(c => !existing.has(c.id))
      .filter(c => {
        if (landlordId && c.companyId === landlordId) {
          return c.name.toLowerCase().includes(searchTerm.toLowerCase());
        }
        if (!landlordId) {
          return c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (c.companyName && c.companyName.toLowerCase().includes(searchTerm.toLowerCase()));
        }
        return false;
      })
      .slice(0, 8);
  }, [allContacts, searchTerm, clients, landlordId]);

  const addMutation = useMutation({
    mutationFn: async (contactId: string) => {
      const res = await apiRequest("POST", `/api/crm/properties/${propertyId}/clients`, { contactId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/properties", propertyId, "clients"] });
      setSearchTerm("");
      setShowSearch(false);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ clientId, role }: { clientId: string; role: string }) => {
      const res = await apiRequest("PUT", `/api/crm/properties/${propertyId}/clients/${clientId}`, { role });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/properties", propertyId, "clients"] });
      setEditingRole(null);
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (clientId: string) => {
      await apiRequest("DELETE", `/api/crm/properties/${propertyId}/clients/${clientId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/properties", propertyId, "clients"] });
    },
  });

  return (
    <Card data-testid="client-board-panel">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4" />
            <h3 className="text-sm font-semibold">Client Board</h3>
            {clients.length > 0 && (
              <Badge variant="secondary" className="text-[10px]">{clients.length}</Badge>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={() => setShowSearch(!showSearch)}
            data-testid="button-add-client"
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            <span className="text-xs">Add</span>
          </Button>
        </div>

        {landlord && (
          <Link href={`/companies/${landlord.id}`}>
            <div className="flex items-center gap-2 px-2 py-1.5 mb-2 rounded-md bg-muted/50 hover:bg-muted transition-colors" data-testid="client-board-landlord">
              <Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="text-xs font-semibold truncate">{landlord.name}</span>
              <Badge variant="secondary" className="text-[10px] shrink-0 ml-auto">Landlord</Badge>
            </div>
          </Link>
        )}

        {showSearch && (
          <div className="mb-3 space-y-1">
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={landlord ? `Search ${landlord.name} contacts...` : "Search contacts..."}
              className="h-8 text-xs"
              autoFocus
              data-testid="input-client-search"
            />
            {filteredContacts.length > 0 && (
              <div className="border rounded-md max-h-40 overflow-y-auto">
                {filteredContacts.map((contact) => (
                  <button
                    key={contact.id}
                    className="w-full text-left px-3 py-1.5 hover:bg-muted/50 flex items-center gap-2 text-xs border-b last:border-0"
                    onClick={() => addMutation.mutate(contact.id)}
                    data-testid={`client-search-result-${contact.id}`}
                  >
                    <Users className="w-3 h-3 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="font-medium truncate block">{contact.name}</span>
                      {contact.role && (
                        <span className="text-[10px] text-muted-foreground truncate block">{contact.role}</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2].map((i) => <Skeleton key={i} className="h-10" />)}
          </div>
        ) : clients.length === 0 && !landlord ? (
          <div className="text-center py-4">
            <Users className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
            <p className="text-xs text-muted-foreground">No clients linked yet</p>
          </div>
        ) : clients.length === 0 ? (
          <p className="text-[10px] text-muted-foreground text-center py-2">Add contacts from {landlord?.name}</p>
        ) : (
          <div className="space-y-1">
            {clients.map((client: any) => (
              <div
                key={client.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/50 group"
                data-testid={`client-item-${client.id}`}
              >
                <Link
                  href={`/contacts/${client.contactId}`}
                  className="flex items-center gap-2 flex-1 min-w-0"
                  data-testid={`link-client-contact-${client.contactId}`}
                >
                  <Users className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-medium truncate block hover:underline">
                      {client.contact?.name || "Unknown"}
                    </span>
                    {client.contact?.role && (
                      <span className="text-[10px] text-muted-foreground truncate block">{client.contact.role}</span>
                    )}
                  </div>
                </Link>
                {editingRole === client.id ? (
                  <Select
                    value={client.role || ""}
                    onValueChange={(val) => updateRoleMutation.mutate({ clientId: client.id, role: val })}
                  >
                    <SelectTrigger className="h-6 w-[130px] text-[10px]" data-testid={`select-client-role-${client.id}`}>
                      <SelectValue placeholder="Set role" />
                    </SelectTrigger>
                    <SelectContent>
                      {CLIENT_ROLE_OPTIONS.map(r => (
                        <SelectItem key={r} value={r}>{r}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <button
                    onClick={() => setEditingRole(client.id)}
                    className="shrink-0"
                    data-testid={`button-edit-role-${client.id}`}
                  >
                    {client.role ? (
                      <Badge variant="outline" className="text-[10px] cursor-pointer hover:bg-muted">{client.role}</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground cursor-pointer hover:bg-muted">Set role</Badge>
                    )}
                  </button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 opacity-0 group-hover:opacity-100 shrink-0"
                  onClick={() => removeMutation.mutate(client.id)}
                  data-testid={`button-remove-client-${client.id}`}
                >
                  <X className="w-3 h-3" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function LinkedContactsPanel({ propertyId }: { propertyId: string }) {
  const { data: deals } = useQuery<CrmDeal[]>({
    queryKey: ["/api/crm/properties", propertyId, "deals"],
    queryFn: async () => {
      const res = await fetch(`/api/crm/properties/${propertyId}/deals`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const contactIds = useMemo(() => {
    if (!deals) return [];
    const ids = new Set<string>();
    deals.forEach((d) => {
      if (d.clientContactId) ids.add(d.clientContactId);
      if (d.tenantId) ids.add(d.tenantId);
    });
    return Array.from(ids);
  }, [deals]);

  const { data: allContacts } = useQuery<CrmContact[]>({
    queryKey: ["/api/crm/contacts"],
    enabled: contactIds.length > 0,
  });

  const linkedContacts = useMemo(() => {
    if (!allContacts || contactIds.length === 0) return [];
    return allContacts.filter((c) => contactIds.includes(c.id));
  }, [allContacts, contactIds]);

  return (
    <Card data-testid="linked-contacts-panel">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Users className="w-4 h-4" />
          <h3 className="text-sm font-semibold">Related Contacts</h3>
          {linkedContacts.length > 0 && (
            <Badge variant="secondary" className="text-[10px]">{linkedContacts.length}</Badge>
          )}
        </div>
        {linkedContacts.length === 0 ? (
          <div className="text-center py-6">
            <Users className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
            <p className="text-xs text-muted-foreground">No contacts linked via deals</p>
          </div>
        ) : (
          <div className="space-y-1">
            {linkedContacts.map((contact) => (
              <div
                key={contact.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md"
                data-testid={`contact-item-${contact.id}`}
              >
                <Users className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-medium truncate block">{contact.name}</span>
                  {contact.companyName && (
                    <span className="text-[10px] text-muted-foreground truncate block">{contact.companyName}</span>
                  )}
                </div>
                {contact.role && (
                  <Badge variant="outline" className="text-[10px] shrink-0">{contact.role}</Badge>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CreatePropertyDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const [formData, setFormData] = useState({
    name: "",
    groupName: "Properties",
    status: "",
    assetClass: [] as string[],
    tenure: "",
    bgpEngagement: [] as string[],
    address: null as any,
    agent: "",
    sqft: "",
    notes: "",
    website: "",
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload: any = { ...formData };
      if (payload.sqft) payload.sqft = parseFloat(payload.sqft);
      else delete payload.sqft;
      Object.keys(payload).forEach((k) => {
        if (payload[k] === "" || (Array.isArray(payload[k]) && payload[k].length === 0)) delete payload[k];
      });
      const res = await apiRequest("POST", "/api/crm/properties", payload);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Property Created", description: `${formData.name} has been added.` });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/properties"] });
      onOpenChange(false);
      setFormData({ name: "", groupName: "Properties", status: "", assetClass: [], tenure: "", bgpEngagement: [], address: null, agent: "", sqft: "", notes: "", website: "" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to create property", variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="dialog-create-property">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="w-5 h-5" />
            New Property
          </DialogTitle>
          <DialogDescription>Add a new property to the CRM</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Name *</Label>
            <Input
              value={formData.name}
              onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
              placeholder="e.g. 123 High Street"
              data-testid="input-property-name"
            />
          </div>
          <div className="space-y-2">
            <Label>Address</Label>
            <AddressAutocomplete
              value={formData.address ? addressToResult(formData.address) : null}
              onChange={(result) => setFormData((p) => ({ ...p, address: resultToAddress(result) }))}
              placeholder="Search for an address..."
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Group</Label>
              <Select value={formData.groupName} onValueChange={(v) => setFormData((p) => ({ ...p, groupName: v }))}>
                <SelectTrigger data-testid="select-group">
                  <SelectValue placeholder="Select group" />
                </SelectTrigger>
                <SelectContent>
                  {GROUP_TABS.filter((g) => g.id !== "all").map((g) => (
                    <SelectItem key={g.id} value={g.id}>{g.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={formData.status} onValueChange={(v) => setFormData((p) => ({ ...p, status: v }))}>
                <SelectTrigger data-testid="select-status">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Asset Class</Label>
              <InlineEngagement
                value={formData.assetClass}
                options={ASSET_CLASS_OPTIONS}
                colorMap={ASSET_CLASS_COLORS}
                onSave={(val) => setFormData((p) => ({ ...p, assetClass: val }))}
                placeholder="Select class"
              />
            </div>
            <div className="space-y-2">
              <Label>Tenure</Label>
              <Select value={formData.tenure} onValueChange={(v) => setFormData((p) => ({ ...p, tenure: v }))}>
                <SelectTrigger data-testid="select-tenure">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  {TENURE_OPTIONS.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Team</Label>
              <InlineEngagement
                value={formData.bgpEngagement}
                options={TEAM_OPTIONS}
                colorMap={TEAM_COLORS}
                onSave={(val) => setFormData((p) => ({ ...p, bgpEngagement: val }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Sq Ft</Label>
              <Input
                type="number"
                value={formData.sqft}
                onChange={(e) => setFormData((p) => ({ ...p, sqft: e.target.value }))}
                placeholder="e.g. 2500"
                data-testid="input-property-sqft"
              />
            </div>
          </div>
          
          <div className="space-y-2">
            <Label>Website</Label>
            <Input
              value={formData.website}
              onChange={(e) => setFormData((p) => ({ ...p, website: e.target.value }))}
              placeholder="e.g. www.example.com"
              data-testid="input-property-website"
            />
          </div>
          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea
              value={formData.notes}
              onChange={(e) => setFormData((p) => ({ ...p, notes: e.target.value }))}
              placeholder="Any additional notes..."
              className="resize-none"
              data-testid="input-property-notes"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-create-property">
            Cancel
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!formData.name || createMutation.isPending}
            data-testid="button-submit-create-property"
          >
            {createMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Plus className="w-4 h-4 mr-2" />
                Create Property
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface PropertyNewsArticle {
  id: string;
  title: string;
  url: string;
  sourceName: string | null;
  summary: string | null;
  publishedAt: string | null;
  imageUrl: string | null;
  source: "database" | "web";
}

function newsTimeAgo(date: string | Date | null): string {
  if (!date) return "";
  const now = new Date();
  const d = new Date(date);
  const diffMs = now.getTime() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function extractPostcode(address: any): string | null {
  if (!address) return null;
  if (typeof address === "object" && address.postcode) return address.postcode;
  const str = typeof address === "string" ? address : formatAddress(address);
  const match = str.match(/[A-Z]{1,2}\d[\dA-Z]?\s*\d?[A-Z]{0,2}/i);
  return match ? match[0].trim() : null;
}

function extractStreet(address: any): string | undefined {
  if (!address) return undefined;
  if (typeof address === "object" && address.street) return address.street;
  return undefined;
}

function IntelligenceSection({ icon: Icon, title, children, defaultOpen = false }: {
  icon: any;
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border rounded-lg overflow-hidden" data-testid={`intelligence-section-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      <button
        className="w-full flex items-center gap-2 p-2.5 hover:bg-muted/50 transition-colors text-left"
        onClick={() => setOpen(!open)}
        data-testid={`button-toggle-${title.toLowerCase().replace(/\s+/g, "-")}`}
      >
        <Icon className="w-3.5 h-3.5 text-primary shrink-0" />
        <span className="text-xs font-semibold flex-1">{title}</span>
        {open ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
      </button>
      {open && <div className="px-2.5 pb-2.5 text-xs space-y-1">{children}</div>}
    </div>
  );
}

export function PropertyKycPanel({ property }: { property: CrmProperty }) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(true);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleNumber, setTitleNumber] = useState(property.titleNumber || "");
  const [proprietorName, setProprietorName] = useState(property.proprietorName || "");
  const [proprietorType, setProprietorType] = useState(property.proprietorType || "company");
  const [proprietorAddress, setProprietorAddress] = useState(property.proprietorAddress || "");
  const [proprietorCompanyNumber, setProprietorCompanyNumber] = useState(property.proprietorCompanyNumber || "");
  const [running, setRunning] = useState(false);
  const [screening, setScreening] = useState(false);
  const [sanctionsResult, setSanctionsResult] = useState<any>(null);

  const [searchingTitles, setSearchingTitles] = useState(false);
  const [freeholdResults, setFreeholdResults] = useState<any[]>([]);
  const [showFreeholds, setShowFreeholds] = useState(false);
  const [fetchingProprietor, setFetchingProprietor] = useState(false);
  const [searchMode, setSearchMode] = useState<"freehold" | "leasehold">("freehold");
  const [leaseholdTitles, setLeaseholdTitles] = useState<string[]>([]);
  const [leaseholdDetails, setLeaseholdDetails] = useState<any[]>([]);
  const [loadingLeaseholds, setLoadingLeaseholds] = useState(false);
  const [leaseholdPage, setLeaseholdPage] = useState(0);
  const LEASEHOLD_PAGE_SIZE = 10;
  const [downloadingKycDoc, setDownloadingKycDoc] = useState<string | null>(null);

  const downloadKycDocument = async (titleNum: string, docType: "register" | "plan" = "register") => {
    setDownloadingKycDoc(`${titleNum}-${docType}`);
    try {
      const res = await fetch("/api/title-search/download-document", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        credentials: "include",
        body: JSON.stringify({ title: titleNum, document: docType }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Download unavailable", description: data.error || "Could not order document", variant: "destructive" });
        return;
      }
      if (data.documentUrl) {
        window.open(data.documentUrl, "_blank");
        const priceStr = data.price?.total_gbp ? ` (£${data.price.total_gbp} inc. VAT)` : "";
        toast({ title: "Document ready", description: `Full Title Search for ${titleNum} opened${priceStr}` });
      } else {
        toast({ title: "Document not ready", description: data.documentStatus || "Please try again shortly" });
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setDownloadingKycDoc(null);
    }
  };

  const kycData = property.proprietorKycData as any;
  const kycStatus = property.proprietorKycStatus;
  const prof = kycData?.profile;

  const postcode = (property.address as any)?.postcode || "";

  const searchFreeholds = async () => {
    if (!postcode) {
      toast({ title: "No postcode", description: "This property needs a postcode to search Land Registry titles.", variant: "destructive" });
      return;
    }
    setSearchingTitles(true);
    try {
      const res = await fetch(`/api/title-search/freeholds?postcode=${encodeURIComponent(postcode)}`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error((await res.json()).error || "Search failed");
      const data = await res.json();
      const titles = data.data || [];
      setFreeholdResults(titles);
      setShowFreeholds(true);
      if (titles.length === 0) {
        toast({ title: "No titles found", description: `No freehold titles found for ${postcode}` });
      }
    } catch (err: any) {
      toast({ title: "Search Error", description: err.message, variant: "destructive" });
    } finally {
      setSearchingTitles(false);
    }
  };

  const searchLeaseholds = async () => {
    if (!postcode) {
      toast({ title: "No postcode", description: "This property needs a postcode to search leasehold titles.", variant: "destructive" });
      return;
    }
    setSearchingTitles(true);
    setLeaseholdTitles([]);
    setLeaseholdDetails([]);
    setLeaseholdPage(0);
    try {
      const fRes = await fetch(`/api/title-search/freeholds?postcode=${encodeURIComponent(postcode)}`, { credentials: "include", headers: getAuthHeaders() });
      if (!fRes.ok) throw new Error("Search failed");
      const fData = await fRes.json();
      const titles = fData.data || [];
      setFreeholdResults(titles);

      let allLeaseholds: string[] = [];
      let failedCount = 0;
      const CHUNK_SIZE = 3;
      for (let i = 0; i < titles.length; i += CHUNK_SIZE) {
        const chunk = titles.slice(i, i + CHUNK_SIZE);
        const results = await Promise.allSettled(
          chunk.map(async (fh: any) => {
            const tn = fh.title_number || fh.title;
            const lRes = await fetch(`/api/title-search/leaseholds/${encodeURIComponent(tn)}`, { credentials: "include", headers: getAuthHeaders() });
            if (!lRes.ok) throw new Error("Failed");
            return lRes.json();
          })
        );
        for (const r of results) {
          if (r.status === "fulfilled" && r.value.leaseholds?.length > 0) {
            allLeaseholds = [...allLeaseholds, ...r.value.leaseholds];
          } else if (r.status === "rejected") {
            failedCount++;
          }
        }
      }

      const uniqueLeaseholds = [...new Set(allLeaseholds)];
      setLeaseholdTitles(uniqueLeaseholds);
      setShowFreeholds(true);

      if (failedCount > 0) {
        toast({ title: "Partial results", description: `${failedCount} of ${titles.length} freehold lookups failed — results may be incomplete.`, variant: "destructive" });
      }

      if (uniqueLeaseholds.length === 0) {
        toast({ title: "No leaseholds found", description: `No leasehold titles found for ${postcode}` });
      } else {
        toast({ title: `${uniqueLeaseholds.length} leaseholds found`, description: `Loading details...` });
        loadLeaseholdBatch(uniqueLeaseholds, 0);
      }
    } catch (err: any) {
      toast({ title: "Search Error", description: err.message, variant: "destructive" });
    } finally {
      setSearchingTitles(false);
    }
  };

  const loadLeaseholdBatch = async (titles: string[], page: number) => {
    setLoadingLeaseholds(true);
    try {
      const start = page * LEASEHOLD_PAGE_SIZE;
      const batch = titles.slice(start, start + LEASEHOLD_PAGE_SIZE);
      if (batch.length === 0) return;

      const res = await fetch("/api/title-search/leasehold-details", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        credentials: "include",
        body: JSON.stringify({ titles: batch }),
      });
      if (!res.ok) throw new Error("Failed to load details");
      const data = await res.json();
      setLeaseholdDetails(prev => [...prev, ...(data.results || [])]);
    } catch (err: any) {
      toast({ title: "Error loading details", description: err.message, variant: "destructive" });
    } finally {
      setLoadingLeaseholds(false);
    }
  };

  const autoFillFromTitle = async (selectedTitle: string) => {
    setFetchingProprietor(true);
    try {
      const res = await fetch(`/api/title-search/auto-fill/${property.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ title: selectedTitle }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Lookup failed");
      const data = await res.json();
      if (!data.success) {
        toast({ title: "No proprietor found", description: data.message, variant: "destructive" });
        setTitleNumber(selectedTitle);
        setEditingTitle(true);
        return;
      }
      setTitleNumber(data.titleNumber);
      setProprietorName(data.proprietorName);
      setProprietorType(data.proprietorType);
      setProprietorAddress(data.proprietorAddress || "");
      setProprietorCompanyNumber(data.proprietorCompanyNumber || "");
      setShowFreeholds(false);
      setEditingTitle(false);
      queryClient.invalidateQueries({ queryKey: ["/api/crm/properties", property.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/properties"] });
      toast({ title: "Title details auto-filled", description: `Proprietor: ${data.proprietorName}` });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setFetchingProprietor(false);
    }
  };

  const saveTitleDetails = async () => {
    try {
      const res = await apiRequest("PUT", `/api/crm/properties/${property.id}`, {
        titleNumber: titleNumber || null,
        proprietorName: proprietorName || null,
        proprietorType: proprietorType || "company",
        proprietorAddress: proprietorAddress || null,
        proprietorCompanyNumber: proprietorCompanyNumber || null,
        titleSearchDate: new Date().toISOString(),
      });
      if (!res.ok) throw new Error("Failed to save");
      queryClient.invalidateQueries({ queryKey: ["/api/crm/properties", property.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/properties"] });
      setEditingTitle(false);
      toast({ title: "Title details saved" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const runPropertyKyc = async () => {
    setRunning(true);
    try {
      const res = await fetch(`/api/companies-house/property-kyc/${property.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ proprietorName, proprietorType, proprietorCompanyNumber }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "KYC check failed");
      }
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/crm/properties", property.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/properties"] });

      if (!data.success) {
        toast({ title: "KYC", description: data.message || "No match found", variant: "destructive" });
        setRunning(false);
        return;
      }

      setScreening(true);
      try {
        const names = [
          { name: proprietorName, role: "Proprietor" },
          ...(data.pscs || []).map((p: any) => ({ name: p.name, role: "PSC" })),
          ...(data.officers || []).map((o: any) => ({ name: o.name, role: o.officerRole?.replace(/-/g, " ") || "Officer" })),
        ].filter((n: any) => n.name?.trim());

        const sRes = await fetch("/api/sanctions/screen", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ names }),
        });
        if (sRes.ok) {
          const sData = await sRes.json();
          setSanctionsResult(sData);
        }
      } catch {}
      setScreening(false);

      toast({ title: "KYC Complete", description: `${data.kycStatus === "pass" ? "Passed" : data.kycStatus === "warning" ? "Needs review" : "Failed"}` });
    } catch (err: any) {
      toast({ title: "KYC Error", description: err.message, variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  const runSanctionsOnly = async () => {
    if (!proprietorName) return;
    setScreening(true);
    try {
      await fetch(`/api/companies-house/property-kyc/${property.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ proprietorName, proprietorType: "individual" }),
      });

      const names = [{ name: proprietorName, role: "Proprietor" }];
      const sRes = await fetch("/api/sanctions/screen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ names }),
      });
      if (sRes.ok) {
        const sData = await sRes.json();
        setSanctionsResult(sData);
        toast({ title: "Sanctions screening complete" });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/crm/properties", property.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/properties"] });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setScreening(false);
    }
  };

  const getKycBadge = () => {
    if (kycStatus === "pass") return <Badge className="text-[9px] bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Passed</Badge>;
    if (kycStatus === "warning") return <Badge className="text-[9px] bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">Review</Badge>;
    if (kycStatus === "fail") return <Badge className="text-[9px] bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">Failed</Badge>;
    if (kycStatus === "individual") return <Badge className="text-[9px] bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">Individual</Badge>;
    if (kycStatus === "not_found") return <Badge variant="outline" className="text-[9px]">Not found</Badge>;
    return null;
  };

  const copyPropertyKycReport = () => {
    const lines: string[] = [];
    lines.push(`PROPERTY KYC REPORT — ${property.name}`);
    lines.push(`Generated: ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`);
    lines.push(`Address: ${property.address ? [
      (property.address as any).line1, (property.address as any).line2, (property.address as any).city, (property.address as any).postcode
    ].filter(Boolean).join(", ") : "N/A"}`);
    lines.push("");
    if (property.titleNumber) lines.push(`Title Number: ${property.titleNumber}`);
    if (property.proprietorName) {
      lines.push(`Registered Proprietor: ${property.proprietorName}`);
      lines.push(`Proprietor Type: ${property.proprietorType === "individual" ? "Individual" : "Company"}`);
    }
    if (property.proprietorAddress) lines.push(`Proprietor Address: ${property.proprietorAddress}`);
    if (property.proprietorCompanyNumber) lines.push(`Company Number: ${property.proprietorCompanyNumber}`);
    lines.push("");
    if (prof) {
      lines.push(`KYC Status: ${kycStatus === "pass" ? "PASS" : kycStatus === "warning" ? "WARNING" : kycStatus === "fail" ? "FAIL" : kycStatus?.toUpperCase() || "NOT CHECKED"}`);
      lines.push(`CH Status: ${prof.companyStatus}`);
      if (prof.companyType) lines.push(`Type: ${prof.companyType}`);
      const pscs = (kycData?.pscs || []).filter((p: any) => !p.ceasedOn);
      if (pscs.length > 0) lines.push(`PSCs: ${pscs.map((p: any) => p.name).join(", ")}`);
      const officers = (kycData?.officers || []).filter((o: any) => !o.resignedOn);
      if (officers.length > 0) lines.push(`Officers: ${officers.map((o: any) => `${o.name} (${o.officerRole?.replace(/-/g, " ")})`).join(", ")}`);
    }
    if (sanctionsResult) {
      lines.push(`Sanctions: ${sanctionsResult.overallStatus === "clear" ? "ALL CLEAR" : sanctionsResult.overallStatus === "review" ? "POTENTIAL MATCHES" : "ALERT"}`);
    }
    lines.push("");
    lines.push("Source: HM Land Registry, Companies House, UK Sanctions List (FCDO)");
    navigator.clipboard.writeText(lines.join("\n"));
    toast({ title: "Property KYC Report Copied" });
  };

  const pscs = (kycData?.pscs || []).filter((p: any) => !p.ceasedOn);
  const officers = (kycData?.officers || []).filter((o: any) => !o.resignedOn);

  return (
    <Card data-testid="card-property-kyc">
      <CardContent className="p-4 space-y-3">
        <button className="w-full flex items-center justify-between" onClick={() => setExpanded(!expanded)}>
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <ShieldCheck className="w-4 h-4" />
            Property KYC & Ownership
            {kycStatus === "pass" && <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />}
            {kycStatus === "fail" && <XCircle className="w-3.5 h-3.5 text-red-500" />}
            {kycStatus === "warning" && <AlertCircle className="w-3.5 h-3.5 text-yellow-500" />}
          </h3>
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>

        {expanded && (
          <div className="space-y-3">
            <div className="border rounded-lg p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileSearch className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs font-semibold">Land Registry Title</span>
                </div>
                <div className="flex items-center gap-1">
                  {getKycBadge()}
                  {!editingTitle && (
                    <Button variant="ghost" size="sm" className="h-5 px-1.5" onClick={() => setEditingTitle(true)} data-testid="button-edit-title">
                      <Pencil className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              </div>

              {editingTitle ? (
                <div className="space-y-2">
                  <div>
                    <Label className="text-[11px]">Title Number</Label>
                    <Input className="h-7 text-xs" placeholder="e.g. NGL123456" value={titleNumber} onChange={e => setTitleNumber(e.target.value)} data-testid="input-title-number" />
                  </div>
                  <div>
                    <Label className="text-[11px]">Registered Proprietor</Label>
                    <Input className="h-7 text-xs" placeholder="Company or individual name from title" value={proprietorName} onChange={e => setProprietorName(e.target.value)} data-testid="input-proprietor-name" />
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <Label className="text-[11px]">Type</Label>
                      <select className="w-full h-7 text-xs border rounded px-2 bg-background" value={proprietorType} onChange={e => setProprietorType(e.target.value)} data-testid="select-proprietor-type">
                        <option value="company">Company</option>
                        <option value="individual">Individual</option>
                      </select>
                    </div>
                    {proprietorType === "company" && (
                      <div className="flex-1">
                        <Label className="text-[11px]">Company No. (optional)</Label>
                        <Input className="h-7 text-xs" placeholder="e.g. 12345678" value={proprietorCompanyNumber} onChange={e => setProprietorCompanyNumber(e.target.value)} data-testid="input-proprietor-ch" />
                      </div>
                    )}
                  </div>
                  <div>
                    <Label className="text-[11px]">Proprietor Address (optional)</Label>
                    <Input className="h-7 text-xs" placeholder="From title register" value={proprietorAddress} onChange={e => setProprietorAddress(e.target.value)} data-testid="input-proprietor-address" />
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" className="h-7 text-[11px] flex-1" onClick={saveTitleDetails} data-testid="button-save-title">
                      <Check className="w-3 h-3 mr-1" /> Save
                    </Button>
                    <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => setEditingTitle(false)} data-testid="button-cancel-title">
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {property.titleNumber ? (
                    <>
                      <div className="flex items-center gap-x-4 text-[11px]">
                        <span className="text-muted-foreground">Title:</span>
                        <span className="font-mono font-medium">{property.titleNumber}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 text-[10px] gap-1 px-1.5"
                          onClick={() => downloadKycDocument(property.titleNumber!, "register")}
                          disabled={downloadingKycDoc === `${property.titleNumber}-register`}
                          data-testid="button-download-title-register"
                        >
                          {downloadingKycDoc === `${property.titleNumber}-register` ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileDown className="w-3 h-3" />}
                          Full Title Search
                        </Button>
                      </div>
                      <div className="flex gap-x-4 text-[11px]">
                        <span className="text-muted-foreground">Proprietor:</span>
                        <span className="font-medium">{property.proprietorName || "—"}</span>
                        <Badge variant="outline" className="text-[9px]">{property.proprietorType === "individual" ? "Individual" : "Company"}</Badge>
                      </div>
                      {property.proprietorCompanyNumber && (
                        <div className="flex gap-x-4 text-[11px]">
                          <span className="text-muted-foreground">Co. No:</span>
                          <a href={`https://find-and-update.company-information.service.gov.uk/company/${property.proprietorCompanyNumber}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-0.5">
                            {property.proprietorCompanyNumber} <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        </div>
                      )}
                      {property.proprietorAddress && (
                        <div className="flex gap-x-4 text-[11px]">
                          <span className="text-muted-foreground">Address:</span>
                          <span>{property.proprietorAddress}</span>
                        </div>
                      )}
                      {property.titleSearchDate && (
                        <div className="text-[10px] text-muted-foreground mt-1">
                          Title entered: {new Date(property.titleSearchDate).toLocaleDateString("en-GB")}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="space-y-2">
                      <div className="text-[11px] text-muted-foreground py-1 text-center">
                        No title details yet. Search Land Registry or enter manually.
                      </div>
                      <div className="flex gap-1 mb-1">
                        <Button
                          variant={searchMode === "freehold" ? "default" : "outline"}
                          size="sm"
                          className="flex-1 h-6 text-[10px]"
                          onClick={() => setSearchMode("freehold")}
                          data-testid="button-mode-freehold"
                        >
                          Freeholds
                        </Button>
                        <Button
                          variant={searchMode === "leasehold" ? "default" : "outline"}
                          size="sm"
                          className="flex-1 h-6 text-[10px]"
                          onClick={() => setSearchMode("leasehold")}
                          data-testid="button-mode-leasehold"
                        >
                          Leaseholds
                        </Button>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 h-7 text-[11px] gap-1"
                          onClick={searchMode === "freehold" ? searchFreeholds : searchLeaseholds}
                          disabled={searchingTitles || !postcode}
                          data-testid="button-search-titles"
                        >
                          {searchingTitles ? <><Loader2 className="w-3 h-3 animate-spin" /> Searching...</> :
                           <><Globe className="w-3 h-3" /> Search {searchMode === "freehold" ? "Freeholds" : "Leaseholds"}</>}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-[11px] gap-1"
                          onClick={() => setEditingTitle(true)}
                          data-testid="button-enter-manually"
                        >
                          <Pencil className="w-3 h-3" /> Enter Manually
                        </Button>
                      </div>
                    </div>
                  )}

                  {showFreeholds && searchMode === "freehold" && freeholdResults.length > 0 && (
                    <div className="border rounded p-2 space-y-1 max-h-48 overflow-y-auto bg-muted/30">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold text-muted-foreground">{freeholdResults.length} freehold{freeholdResults.length !== 1 ? "s" : ""} found for {postcode}</span>
                        <Button variant="ghost" size="sm" className="h-5 px-1" onClick={() => setShowFreeholds(false)}>
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                      {freeholdResults.map((t: any, idx: number) => {
                        const tn = t.title_number || t.title;
                        return (
                          <div key={idx} className="flex items-center justify-between p-1.5 rounded hover:bg-muted transition-colors text-[11px] gap-1">
                            <div className="flex-1 min-w-0">
                              <span className="font-mono font-medium">{tn}</span>
                              {t.address && <span className="text-muted-foreground ml-2 truncate">{t.address}</span>}
                              {t.ownership_type && <Badge variant="outline" className="text-[8px] ml-1">{t.ownership_type}</Badge>}
                            </div>
                            <div className="flex items-center gap-0.5 shrink-0">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-5 px-1 text-[9px] gap-0.5"
                                onClick={() => downloadKycDocument(tn, "register")}
                                disabled={downloadingKycDoc === `${tn}-register`}
                                data-testid={`button-download-freehold-${idx}`}
                              >
                                {downloadingKycDoc === `${tn}-register` ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <FileDown className="w-2.5 h-2.5" />}
                              </Button>
                              <button
                                className="p-1 rounded hover:bg-muted/50"
                                onClick={() => autoFillFromTitle(tn)}
                                disabled={fetchingProprietor}
                                data-testid={`button-select-title-${idx}`}
                              >
                                {fetchingProprietor ? <Loader2 className="w-3 h-3 animate-spin" /> :
                                 <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {showFreeholds && searchMode === "leasehold" && leaseholdTitles.length > 0 && (
                    <div className="border rounded p-2 space-y-1 max-h-64 overflow-y-auto bg-muted/30">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold text-muted-foreground">{leaseholdTitles.length} leasehold{leaseholdTitles.length !== 1 ? "s" : ""} found for {postcode}</span>
                        <Button variant="ghost" size="sm" className="h-5 px-1" onClick={() => setShowFreeholds(false)}>
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                      {leaseholdDetails.map((ld: any, idx: number) => (
                        <div key={idx} className="flex items-center justify-between p-1.5 rounded hover:bg-muted transition-colors text-[11px] gap-1">
                          <div className="flex-1 min-w-0">
                            <span className="font-mono font-medium">{ld.titleNumber}</span>
                            {ld.ownership?.details?.owner && (
                              <span className="text-muted-foreground ml-2 truncate">{ld.ownership.details.owner}</span>
                            )}
                            <Badge variant="outline" className="text-[8px] ml-1">{ld.class || "Leasehold"}</Badge>
                          </div>
                          <div className="flex items-center gap-0.5 shrink-0">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-5 px-1 text-[9px] gap-0.5"
                              onClick={() => downloadKycDocument(ld.titleNumber, "register")}
                              disabled={downloadingKycDoc === `${ld.titleNumber}-register`}
                              data-testid={`button-download-leasehold-${idx}`}
                            >
                              {downloadingKycDoc === `${ld.titleNumber}-register` ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <FileDown className="w-2.5 h-2.5" />}
                            </Button>
                            <button
                              className="p-1 rounded hover:bg-muted/50"
                              onClick={() => autoFillFromTitle(ld.titleNumber)}
                              disabled={fetchingProprietor}
                              data-testid={`button-select-leasehold-${idx}`}
                            >
                              {fetchingProprietor ? <Loader2 className="w-3 h-3 animate-spin" /> :
                               <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                            </button>
                          </div>
                        </div>
                      ))}
                      {loadingLeaseholds && (
                        <div className="flex items-center gap-2 p-1.5 text-[10px] text-muted-foreground">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          Loading leasehold details...
                        </div>
                      )}
                      {!loadingLeaseholds && leaseholdDetails.length < leaseholdTitles.length && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full h-6 text-[10px]"
                          onClick={() => {
                            const nextPage = leaseholdPage + 1;
                            setLeaseholdPage(nextPage);
                            loadLeaseholdBatch(leaseholdTitles, nextPage);
                          }}
                          data-testid="button-load-more-leaseholds"
                        >
                          Load more ({leaseholdDetails.length} of {leaseholdTitles.length})
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {prof && (
              <div className="border rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs font-semibold">Companies House — {prof.companyName}</span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
                  <a href={`https://find-and-update.company-information.service.gov.uk/company/${prof.companyNumber}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-0.5">
                    CH: {prof.companyNumber} <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                  <span>Status: <span className={prof.companyStatus === "active" ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>{prof.companyStatus}</span></span>
                  {prof.companyType && <span>Type: {prof.companyType}</span>}
                  {prof.dateOfCreation && <span>Incorporated: {prof.dateOfCreation}</span>}
                </div>

                {pscs.length > 0 && (
                  <div className="text-[11px]">
                    <span className="text-muted-foreground font-medium">PSCs: </span>
                    {pscs.map((p: any, i: number) => (
                      <span key={i}>{i > 0 ? ", " : ""}{p.name}{p.nationality ? ` (${p.nationality})` : ""}</span>
                    ))}
                  </div>
                )}

                {officers.length > 0 && (
                  <div className="text-[11px]">
                    <span className="text-muted-foreground font-medium">Officers: </span>
                    {officers.slice(0, 3).map((o: any, i: number) => (
                      <span key={i}>{i > 0 ? ", " : ""}{o.name}</span>
                    ))}
                    {officers.length > 3 && <span className="text-muted-foreground"> +{officers.length - 3} more</span>}
                  </div>
                )}

                {kycData?.checkedAt && (
                  <div className="text-[10px] text-muted-foreground">
                    Checked: {new Date(kycData.checkedAt).toLocaleDateString("en-GB")}
                  </div>
                )}
              </div>
            )}

            {sanctionsResult?.results && (
              <div className={`flex items-center gap-1.5 p-2 rounded text-[11px] ${
                sanctionsResult.overallStatus === "clear" ? "bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200" :
                sanctionsResult.overallStatus === "review" ? "bg-yellow-50 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-200" :
                "bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200"
              }`}>
                {sanctionsResult.overallStatus === "clear" ? <CheckCircle2 className="w-3 h-3" /> :
                 sanctionsResult.overallStatus === "review" ? <AlertCircle className="w-3 h-3" /> :
                 <XCircle className="w-3 h-3" />}
                <span>
                  {sanctionsResult.overallStatus === "clear" ? "All names cleared against UK Sanctions List" :
                   sanctionsResult.overallStatus === "review" ? "Potential sanctions matches — review required" :
                   "Sanctions matches found — investigate immediately"}
                </span>
              </div>
            )}

            <div className="flex gap-1">
              {property.proprietorName && property.proprietorType === "company" && (
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 h-7 text-[11px] gap-1"
                  onClick={runPropertyKyc}
                  disabled={running || screening}
                  data-testid="button-run-property-kyc"
                >
                  {running ? <><Loader2 className="w-3 h-3 animate-spin" /> Running KYC...</> :
                   screening ? <><Loader2 className="w-3 h-3 animate-spin" /> Screening sanctions...</> :
                   <><ShieldCheck className="w-3 h-3" /> Run KYC + Sanctions</>}
                </Button>
              )}
              {property.proprietorName && property.proprietorType === "individual" && (
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 h-7 text-[11px] gap-1"
                  onClick={runSanctionsOnly}
                  disabled={screening}
                  data-testid="button-run-sanctions-only"
                >
                  {screening ? <><Loader2 className="w-3 h-3 animate-spin" /> Screening...</> :
                   <><ShieldCheck className="w-3 h-3" /> Screen Sanctions</>}
                </Button>
              )}
              {(kycStatus || sanctionsResult) && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px] gap-1"
                  onClick={copyPropertyKycReport}
                  data-testid="button-copy-property-kyc"
                >
                  <Copy className="w-3 h-3" /> Copy Report
                </Button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function LeasingTrackerSummary({ propertyId }: { propertyId: string }) {
  const { data: units, isLoading } = useQuery<any[]>({
    queryKey: ["/api/available-units", { propertyId }],
    queryFn: async () => {
      const res = await fetch(`/api/available-units?propertyId=${propertyId}`, { credentials: "include", headers: getAuthHeaders() });
      return res.json();
    },
  });

  const { data: viewingCounts } = useQuery<Record<string, number>>({
    queryKey: ["/api/available-units/all-viewings-counts"],
  });

  const { data: offerCounts } = useQuery<Record<string, number>>({
    queryKey: ["/api/available-units/all-offers-counts"],
  });

  const [expanded, setExpanded] = useState(true);

  if (isLoading) return null;

  const safeUnits = units || [];
  const hasUnits = safeUnits.length > 0;
  const totalUnits = safeUnits.length;
  const available = safeUnits.filter(u => legacyToCode(u.marketingStatus) === "AVA").length;
  const underOffer = safeUnits.filter(u => legacyToCode(u.marketingStatus) === "SOL").length;
  const let_ = safeUnits.filter(u => legacyToCode(u.marketingStatus) === "COM").length;
  const totalSqft = safeUnits.reduce((s: number, u: any) => s + (u.sqft || 0), 0);
  const availSqft = safeUnits.filter(u => legacyToCode(u.marketingStatus) === "AVA").reduce((s: number, u: any) => s + (u.sqft || 0), 0);
  const totalViewings = safeUnits.reduce((s: number, u: any) => s + (viewingCounts?.[u.id] || 0), 0);
  const totalOffers = safeUnits.reduce((s: number, u: any) => s + (offerCounts?.[u.id] || 0), 0);

  const statusColor = (status: string) => {
    const code = legacyToCode(status);
    if (code === "AVA") return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
    if (code === "SOL") return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
    if (code === "COM") return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
    if (code === "WIT") return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200";
    return "bg-gray-100 text-gray-600";
  };

  return (
    <Card data-testid="card-leasing-tracker-summary">
      <CardContent className="p-4 space-y-3">
        <button className="w-full flex items-center justify-between" onClick={() => setExpanded(!expanded)}>
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Building2 className="w-4 h-4" />
            Leasing Tracker
            <Badge variant="outline" className="text-[9px]">{totalUnits} unit{totalUnits !== 1 ? "s" : ""}</Badge>
          </h3>
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>

        {expanded && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="border rounded-lg p-2 text-center">
                <p className="text-lg font-bold text-green-600">{available}</p>
                <p className="text-[10px] text-muted-foreground">Available</p>
              </div>
              <div className="border rounded-lg p-2 text-center">
                <p className="text-lg font-bold text-yellow-600">{underOffer}</p>
                <p className="text-[10px] text-muted-foreground">Under Offer</p>
              </div>
              <div className="border rounded-lg p-2 text-center">
                <p className="text-lg font-bold text-blue-600">{let_}</p>
                <p className="text-[10px] text-muted-foreground">Let</p>
              </div>
              <div className="border rounded-lg p-2 text-center">
                <p className="text-lg font-bold">{totalUnits}</p>
                <p className="text-[10px] text-muted-foreground">Total Units</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              <span>Total: <strong>{totalSqft.toLocaleString()} sq ft</strong></span>
              <span>Available: <strong>{availSqft.toLocaleString()} sq ft</strong></span>
              <span>Viewings: <strong>{totalViewings}</strong></span>
              <span>Offers: <strong>{totalOffers}</strong></span>
            </div>

            <div className="space-y-1.5">
              {!hasUnits && (
                <div className="text-center py-4 text-muted-foreground">
                  <Building2 className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <p className="text-xs">No units added yet</p>
                  <p className="text-[10px]">Add units in the Leasing Tracker to track availability</p>
                </div>
              )}
              {safeUnits.map((unit: any) => {
                const vc = viewingCounts?.[unit.id] || 0;
                const oc = offerCounts?.[unit.id] || 0;
                return (
                  <div key={unit.id} className="flex items-center justify-between border rounded-lg px-3 py-1.5" data-testid={`leasing-unit-${unit.id}`}>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs font-medium truncate">{unit.unitName}</span>
                      {unit.floor && <span className="text-[10px] text-muted-foreground">{unit.floor}</span>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {unit.sqft && <span className="text-[10px] text-muted-foreground">{unit.sqft.toLocaleString()} sqft</span>}
                      {unit.askingRent && <span className="text-[10px] text-muted-foreground">£{unit.askingRent.toLocaleString()}/pa</span>}
                      {vc > 0 && <span className="text-[10px] text-muted-foreground flex items-center gap-0.5"><Eye className="w-2.5 h-2.5" />{vc}</span>}
                      {oc > 0 && <span className="text-[10px] text-muted-foreground flex items-center gap-0.5"><FileText className="w-2.5 h-2.5" />{oc}</span>}
                      <Badge className={`text-[9px] ${statusColor(unit.marketingStatus || "AVA")}`}>{(() => { const c = legacyToCode(unit.marketingStatus); return c ? DEAL_STATUS_LABELS[c] : (unit.marketingStatus || "Available"); })()}</Badge>
                    </div>
                  </div>
                );
              })}
            </div>

            <Link href={`/deals?tab=letting&propertyId=${propertyId}`}>
              <Button variant="outline" size="sm" className="w-full h-7 text-[11px] gap-1" data-testid="button-view-leasing-tracker">
                <ExternalLink className="w-3 h-3" />
                Open in Leasing Tracker
              </Button>
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function PropertyIntelligencePanel({ property }: { property: CrmProperty }) {
  const { toast } = useToast();
  const postcode = extractPostcode(property.address);
  const street = extractStreet(property.address);
  const [showFullReport, setShowFullReport] = useState(false);

  const fullAddress = formatAddress(property.address);
  const { data, isLoading, refetch, isFetching } = useQuery<any>({
    queryKey: ["/api/property-lookup", postcode, street || "", fullAddress],
    queryFn: async () => {
      if (!postcode) return null;
      const params = new URLSearchParams({ postcode, layers: "core,extended" });
      if (street) params.set("street", street);
      params.set("address", fullAddress);
      const res = await fetch(`/api/property-lookup?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load intelligence data");
      return res.json();
    },
    enabled: !!postcode,
    staleTime: 10 * 60 * 1000,
  });

  const [fetchingTitle, setFetchingTitle] = useState<string | null>(null);
  const [aiMatch, setAiMatch] = useState<{ matchIndex: number | null; titleNumber: string | null; confidence: string; reason: string } | null>(null);
  const [aiMatchLoading, setAiMatchLoading] = useState(false);
  const [aiMatchRan, setAiMatchRan] = useState(false);
  const [expandedLeaseholds, setExpandedLeaseholds] = useState<Record<string, boolean>>({});
  const [leaseholdsData, setLeaseholdsData] = useState<Record<string, { titles: string[]; details: any[]; loading: boolean; page: number }>>({});
  const [downloadingDoc, setDownloadingDoc] = useState<string | null>(null);

  if (!postcode) {
    return (
      <Card data-testid="property-intelligence-panel">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Brain className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">Property Intelligence</span>
          </div>
          <div className="text-center py-6 text-muted-foreground">
            <Brain className="w-6 h-6 mx-auto mb-2 opacity-30" />
            <p className="text-xs">No postcode available — add an address to enable intelligence</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const freeholds = data?.propertyDataCoUk?.freeholds?.data || [];
  const hasFreeholds = freeholds.length > 0;

  const downloadTitleDocument = async (titleNumber: string, docType: "register" | "plan" = "register") => {
    setDownloadingDoc(`${titleNumber}-${docType}`);
    try {
      const res = await fetch("/api/title-search/download-document", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        credentials: "include",
        body: JSON.stringify({ title: titleNumber, document: docType }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Download unavailable", description: data.error || "Could not order document", variant: "destructive" });
        return;
      }
      if (data.documentUrl) {
        window.open(data.documentUrl, "_blank");
        const priceStr = data.price?.total_gbp ? ` (£${data.price.total_gbp} inc. VAT)` : "";
        toast({ title: "Document ready", description: `Full Title Search for ${titleNumber} opened${priceStr}` });
      } else {
        toast({ title: "Document not ready", description: data.documentStatus || "Please try again shortly" });
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setDownloadingDoc(null);
    }
  };

  const loadFreeholdLeaseholds = async (titleNumber: string) => {
    const current = leaseholdsData[titleNumber];
    if (current) {
      setExpandedLeaseholds(prev => ({ ...prev, [titleNumber]: !prev[titleNumber] }));
      return;
    }
    setExpandedLeaseholds(prev => ({ ...prev, [titleNumber]: true }));
    setLeaseholdsData(prev => ({ ...prev, [titleNumber]: { titles: [], details: [], loading: true, page: 0 } }));
    try {
      const res = await fetch(`/api/title-search/leaseholds/${encodeURIComponent(titleNumber)}`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      const titles = data.leaseholds || [];
      setLeaseholdsData(prev => ({ ...prev, [titleNumber]: { titles, details: [], loading: false, page: 0 } }));
      if (titles.length > 0) {
        loadLeaseholdDetailBatch(titleNumber, titles, 0);
      }
    } catch {
      setLeaseholdsData(prev => ({ ...prev, [titleNumber]: { titles: [], details: [], loading: false, page: 0, error: true } as any }));
    }
  };

  const loadLeaseholdDetailBatch = async (freeholdTitle: string, titles: string[], page: number) => {
    const PAGE_SIZE = 10;
    const start = page * PAGE_SIZE;
    const batch = titles.slice(start, start + PAGE_SIZE);
    if (batch.length === 0) return;
    setLeaseholdsData(prev => ({
      ...prev,
      [freeholdTitle]: { ...prev[freeholdTitle], loading: true },
    }));
    try {
      const res = await fetch("/api/title-search/leasehold-details", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        credentials: "include",
        body: JSON.stringify({ titles: batch }),
      });
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setLeaseholdsData(prev => ({
        ...prev,
        [freeholdTitle]: {
          ...prev[freeholdTitle],
          details: [...(prev[freeholdTitle]?.details || []), ...(data.results || [])],
          loading: false,
          page,
        },
      }));
    } catch {
      setLeaseholdsData(prev => ({
        ...prev,
        [freeholdTitle]: { ...prev[freeholdTitle], loading: false },
      }));
    }
  };

  useEffect(() => {
    setAiMatch(null);
    setAiMatchRan(false);
    setAiMatchLoading(false);
  }, [property.id]);

  useEffect(() => {
    if (hasFreeholds && !aiMatchRan && !property.titleNumber && fullAddress) {
      setAiMatchRan(true);
      setAiMatchLoading(true);
      fetch("/api/title-search/ai-match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ propertyAddress: fullAddress, freeholds }),
      })
        .then(r => {
          if (!r.ok) throw new Error("AI match failed");
          return r.json();
        })
        .then(d => {
          if (d.match) {
            setAiMatch(d.match);
            if (d.match.titleNumber && (d.match.confidence === "high" || d.match.confidence === "medium")) {
              fillTitleFromIntelligence(d.match.titleNumber);
            }
          }
        })
        .catch(() => setAiMatch(null))
        .finally(() => setAiMatchLoading(false));
    }
  }, [hasFreeholds, aiMatchRan, property.titleNumber, fullAddress]);

  const fillTitleFromIntelligence = async (selectedTitle: string) => {
    setFetchingTitle(selectedTitle);
    try {
      const res = await fetch(`/api/title-search/auto-fill/${property.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ title: selectedTitle }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Lookup failed");
      const result = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/crm/properties", property.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/properties"] });
      queryClient.invalidateQueries({ queryKey: ["/api/property-lookup"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
      if (result.success) {
        const landlordMsg = result.landlordCompanyId ? " — linked as landlord" : "";
        toast({ title: "Title auto-filled", description: `Proprietor: ${result.proprietorName}${landlordMsg}` });
      } else if (result.titleNumber) {
        toast({ title: "Title saved", description: result.message || "Enter proprietor details manually in the KYC panel." });
      } else {
        toast({ title: "No proprietor found", description: result.message || "Enter details manually in the KYC panel.", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setFetchingTitle(null);
    }
  };

  const hasVoa = data?.voaRatings?.length > 0;
  const hasEpc = data?.epc?.length > 0;
  const hasFlood = !!data?.floodRisk;
  const hasPlanning = data?.planningData && Object.keys(data.planningData).some((k: string) => data.planningData[k]?.length > 0);
  const hasTfl = data?.tflNearby?.stations?.length > 0;
  const hasPricePaid = data?.pricePaid?.length > 0;
  const hasListed = data?.listedBuilding?.length > 0;
  const hasPdStats = data?.propertyDataCoUk?.["postcode-key-stats"]?.data;
  const planningAppsRaw = data?.propertyDataCoUk?.["planning-applications"]?.data;
  const planningApps = Array.isArray(planningAppsRaw) ? planningAppsRaw : (planningAppsRaw?.planning_applications || []);
  const hasPlanningApps = planningApps.length > 0;

  return (
    <Card data-testid="property-intelligence-panel">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">Property Intelligence</span>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{postcode}</Badge>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => setShowFullReport(!showFullReport)}
              data-testid="button-toggle-full-report"
            >
              {showFullReport ? <Eye className="w-3 h-3" /> : <FileText className="w-3 h-3" />}
              {showFullReport ? "Summary" : "Full Report"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => refetch()}
              disabled={isFetching}
              data-testid="button-refresh-intelligence"
            >
              <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : !data ? (
          <div className="text-center py-6 text-muted-foreground">
            <AlertCircle className="w-6 h-6 mx-auto mb-2 opacity-30" />
            <p className="text-xs">Could not load intelligence data</p>
          </div>
        ) : showFullReport ? (
          <ScrollArea className="max-h-[600px]">
            <div className="space-y-2">
              {hasFreeholds && (
                <IntelligenceSection icon={FileSearch} title="Land & Ownership" defaultOpen>
                  <div className="space-y-1">
                    <p className="text-[10px] text-muted-foreground mb-1">{freeholds.length} freehold title{freeholds.length !== 1 ? "s" : ""} found for {postcode}</p>
                    {aiMatchLoading && (
                      <div className="flex items-center gap-2 p-2 bg-violet-50 dark:bg-violet-950/30 rounded text-[10px] text-violet-700 dark:text-violet-300">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        AI is matching your property address to the correct title...
                      </div>
                    )}
                    {aiMatch && aiMatch.confidence !== "none" && !property.titleNumber && (
                      <div className="p-2 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <Sparkles className="w-3 h-3 text-green-600" />
                          <span className="text-[10px] font-semibold text-green-800 dark:text-green-200">AI Recommendation</span>
                          <Badge variant="outline" className={`text-[8px] ${aiMatch.confidence === "high" ? "border-green-500 text-green-700" : aiMatch.confidence === "medium" ? "border-yellow-500 text-yellow-700" : "border-orange-500 text-orange-700"}`}>
                            {aiMatch.confidence} confidence
                          </Badge>
                        </div>
                        <p className="text-[10px] text-muted-foreground">{aiMatch.reason}</p>
                      </div>
                    )}
                    {(() => {
                      const sorted = [...freeholds].sort((a: any, b: any) => {
                        const tnA = a.title_number || a.title;
                        const tnB = b.title_number || b.title;
                        if (aiMatch?.titleNumber === tnA) return -1;
                        if (aiMatch?.titleNumber === tnB) return 1;
                        return 0;
                      });
                      return sorted.map((fh: any, i: number) => {
                        const tn = fh.title_number || fh.title;
                        const isSelected = property.titleNumber === tn;
                        const isAiRecommended = aiMatch?.titleNumber === tn && aiMatch.confidence !== "none" && !property.titleNumber;
                        const lhCount = fh.polygons?.[0]?.leaseholds || 0;
                        const lhData = leaseholdsData[tn];
                        const isExpanded = expandedLeaseholds[tn];
                        return (
                          <div key={tn} className="space-y-1">
                            <div className={`flex items-center justify-between p-2 rounded ${isSelected ? "bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800" : isAiRecommended ? "bg-green-50 dark:bg-green-950/20 border border-green-300 dark:border-green-800" : "bg-muted/30"}`}>
                              <div className="min-w-0 flex-1">
                                <span className="font-mono font-medium text-[11px]">{tn}</span>
                                {fh.address && <span className="text-[10px] text-muted-foreground ml-2">{fh.address}</span>}
                                {fh.ownership_type && <Badge variant="outline" className="text-[8px] ml-1">{fh.ownership_type}</Badge>}
                                {isSelected && <Badge className="text-[8px] ml-1 bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">Selected</Badge>}
                                {isAiRecommended && <Badge className="text-[8px] ml-1 bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">AI Match</Badge>}
                                {lhCount > 0 && (
                                  <Badge variant="outline" className="text-[8px] ml-1 cursor-pointer hover:bg-muted" onClick={() => loadFreeholdLeaseholds(tn)}>
                                    {lhCount} lease{lhCount !== 1 ? "s" : ""}
                                    {isExpanded ? " ▾" : " ▸"}
                                  </Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 text-[10px] gap-1"
                                  onClick={() => downloadTitleDocument(tn, "register")}
                                  disabled={downloadingDoc === `${tn}-register`}
                                  data-testid={`button-download-register-${i}`}
                                >
                                  {downloadingDoc === `${tn}-register` ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileDown className="w-3 h-3" />}
                                  Full Title Search
                                </Button>
                                {!isSelected && (
                                  <Button
                                    variant={isAiRecommended ? "default" : "ghost"}
                                    size="sm"
                                    className={`h-6 text-[10px] gap-1 ${isAiRecommended ? "bg-green-600 hover:bg-green-700 text-white" : ""}`}
                                    onClick={() => fillTitleFromIntelligence(tn)}
                                    disabled={!!fetchingTitle}
                                    data-testid={`button-fill-title-${i}`}
                                  >
                                    {fetchingTitle === tn ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
                                    {fetchingTitle === tn ? "Fetching..." : isAiRecommended ? "Use this title" : "Use for KYC"}
                                  </Button>
                                )}
                              </div>
                            </div>
                            {isExpanded && lhData && (
                              <div className="ml-4 border-l-2 border-muted pl-2 space-y-1">
                                {lhData.loading && lhData.details.length === 0 && (
                                  <div className="flex items-center gap-2 p-1.5 text-[10px] text-muted-foreground">
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                    Loading leaseholds...
                                  </div>
                                )}
                                {!lhData.loading && lhData.titles.length === 0 && (
                                  <div className="p-1.5 text-[10px] text-muted-foreground">
                                    {(lhData as any).error ? "Failed to load leaseholds" : "No leasehold titles found"}
                                  </div>
                                )}
                                {lhData.details.map((ld: any, li: number) => (
                                  <div key={li} className="flex items-center justify-between p-1.5 rounded bg-muted/20 text-[10px]">
                                    <div className="min-w-0 flex-1">
                                      <span className="font-mono font-medium">{ld.titleNumber}</span>
                                      {ld.ownership?.details?.owner && (
                                        <span className="text-muted-foreground ml-1.5">{ld.ownership.details.owner}</span>
                                      )}
                                      {ld.ownership?.type && <Badge variant="outline" className="text-[7px] ml-1">{ld.ownership.type}</Badge>}
                                    </div>
                                    <div className="flex items-center gap-0.5 shrink-0">
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-5 text-[9px] gap-0.5"
                                        onClick={() => downloadTitleDocument(ld.titleNumber, "register")}
                                        disabled={downloadingDoc === `${ld.titleNumber}-register`}
                                        data-testid={`button-download-leasehold-intel-${li}`}
                                      >
                                        {downloadingDoc === `${ld.titleNumber}-register` ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <FileDown className="w-2.5 h-2.5" />}
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-5 text-[9px] gap-0.5"
                                        onClick={() => fillTitleFromIntelligence(ld.titleNumber)}
                                        disabled={!!fetchingTitle}
                                        data-testid={`button-fill-leasehold-${li}`}
                                      >
                                        {fetchingTitle === ld.titleNumber ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <ShieldCheck className="w-2.5 h-2.5" />}
                                        Use
                                      </Button>
                                    </div>
                                  </div>
                                ))}
                                {!lhData.loading && lhData.details.length < lhData.titles.length && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="w-full h-5 text-[9px]"
                                    onClick={() => loadLeaseholdDetailBatch(tn, lhData.titles, lhData.page + 1)}
                                    data-testid={`button-more-leaseholds-${i}`}
                                  >
                                    Load more ({lhData.details.length} of {lhData.titles.length})
                                  </Button>
                                )}
                                {lhData.loading && lhData.details.length > 0 && (
                                  <div className="flex items-center gap-2 p-1 text-[9px] text-muted-foreground">
                                    <Loader2 className="w-2.5 h-2.5 animate-spin" />
                                    Loading more...
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      });
                    })()}
                  </div>
                </IntelligenceSection>
              )}
              {hasEpc && (
                <IntelligenceSection icon={Zap} title="Energy Performance (EPC)" defaultOpen>
                  {data.epc.slice(0, 5).map((epc: any, i: number) => (
                    <div key={i} className="p-2 bg-muted/30 rounded space-y-0.5">
                      <p className="font-medium">{epc.address}</p>
                      <p>Rating: <span className="font-semibold">{epc.ratingBand || epc.rating}</span> {epc.score ? `(score: ${epc.score})` : ""}</p>
                      <p>Type: {epc.propertyType} · Floor area: {epc.floorArea}m²</p>
                      {epc.inspectionDate && <p className="text-muted-foreground">Inspected: {epc.inspectionDate}</p>}
                    </div>
                  ))}
                </IntelligenceSection>
              )}
              {hasVoa && (
                <IntelligenceSection icon={Landmark} title="Rateable Values (VOA)" defaultOpen>
                  {data.voaRatings.slice(0, 5).map((voa: any, i: number) => (
                    <div key={i} className="p-2 bg-muted/30 rounded space-y-0.5">
                      <p className="font-medium">{voa.firmName || voa.address}</p>
                      <p>{voa.description}</p>
                      <p>Rateable Value: <span className="font-semibold">£{Number(voa.rateableValue || 0).toLocaleString()}</span></p>
                    </div>
                  ))}
                </IntelligenceSection>
              )}
              {hasFlood && (
                <IntelligenceSection icon={Droplets} title="Flood Risk" defaultOpen>
                  {data.floodRisk.activeFloods > 0 ? (
                    <div className="p-2 bg-red-50 dark:bg-red-950/30 rounded text-red-700 dark:text-red-400">
                      <p className="font-semibold">⚠ {data.floodRisk.activeFloods} active flood warning(s)</p>
                      {data.floodRisk.floodWarnings?.map((w: any, i: number) => (
                        <p key={i}>{w.description} — Severity: {w.severity}</p>
                      ))}
                    </div>
                  ) : (
                    <p className="text-green-700 dark:text-green-400 p-2 bg-green-50 dark:bg-green-950/30 rounded">No active flood warnings</p>
                  )}
                  {data.floodRisk.nearbyFloodAreas?.length > 0 && (
                    <div className="mt-1">
                      <p className="font-medium text-muted-foreground">Nearby flood areas:</p>
                      {data.floodRisk.nearbyFloodAreas.map((a: any, i: number) => (
                        <p key={i}>· {a.name}{a.riverOrSea ? ` (${a.riverOrSea})` : ""}</p>
                      ))}
                    </div>
                  )}
                </IntelligenceSection>
              )}
              {hasPricePaid && (
                <IntelligenceSection icon={TrendingUp} title="Transaction History">
                  {data.pricePaid.slice(0, 8).map((tx: any, i: number) => (
                    <div key={i} className="flex justify-between p-1.5 bg-muted/30 rounded">
                      <span>{tx.address} ({tx.propertyType})</span>
                      <span className="font-semibold">£{Number(tx.price || 0).toLocaleString()} · {tx.date}</span>
                    </div>
                  ))}
                </IntelligenceSection>
              )}
              {hasPlanning && (
                <IntelligenceSection icon={ShieldAlert} title="Planning & Heritage">
                  {Object.entries(data.planningData).filter(([, v]: any) => Array.isArray(v) && v.length > 0).map(([key, items]: any) => (
                    <div key={key}>
                      <p className="font-medium capitalize mt-1">{key.replace(/([A-Z])/g, " $1").trim()}</p>
                      {items.slice(0, 3).map((item: any, i: number) => (
                        <p key={i} className="text-muted-foreground pl-2">· {item.name}{item.designationDate ? ` (${item.designationDate})` : ""}</p>
                      ))}
                    </div>
                  ))}
                </IntelligenceSection>
              )}
              {hasPlanningApps && (
                <IntelligenceSection icon={FileText} title={`Planning Applications (${planningApps.length})`} defaultOpen>
                  <div className="space-y-2 max-h-[400px] overflow-y-auto">
                    {planningApps.map((pa: any, i: number) => {
                      const status = (pa.status || pa.decision || "").toLowerCase();
                      const isApproved = status.includes("approved") || status.includes("granted") || status.includes("permitted");
                      const isRefused = status.includes("refused") || status.includes("rejected") || status.includes("withdrawn");
                      const isPending = status.includes("pending") || status.includes("registered") || status.includes("awaiting");
                      return (
                        <div key={i} className="p-2 bg-muted/30 rounded space-y-0.5" data-testid={`planning-app-${i}`}>
                          <div className="flex items-start justify-between gap-2">
                            <p className="font-medium text-sm flex-1">{pa.proposal || pa.description || "Planning Application"}</p>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${isApproved ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : isRefused ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" : isPending ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400" : "bg-muted text-muted-foreground"}`}>
                              {pa.status || pa.decision || "Unknown"}
                            </span>
                          </div>
                          {pa.address && <p className="text-xs text-muted-foreground">{pa.address}</p>}
                          <div className="flex gap-3 text-[10px] text-muted-foreground">
                            {(pa.dates?.received_at || pa.date) && <span>Received: {pa.dates?.received_at || pa.date}</span>}
                            {pa.dates?.decided_at && <span>Decided: {pa.dates.decided_at}</span>}
                            {pa.reference && <span>Ref: {pa.reference}</span>}
                          </div>
                          {pa.type && <p className="text-[10px] text-muted-foreground">Type: {pa.type}</p>}
                        </div>
                      );
                    })}
                  </div>
                </IntelligenceSection>
              )}
              {hasListed && (
                <IntelligenceSection icon={Landmark} title="Listed Buildings Nearby">
                  {data.listedBuilding.slice(0, 5).map((lb: any, i: number) => (
                    <div key={i} className="p-1.5 bg-muted/30 rounded">
                      <p className="font-medium">{lb.name}</p>
                      <p className="text-muted-foreground">Grade {lb.grade}</p>
                    </div>
                  ))}
                </IntelligenceSection>
              )}
              {hasTfl && (
                <IntelligenceSection icon={Train} title="Transport Links (TfL)">
                  {data.tflNearby.stations.slice(0, 8).map((station: any, i: number) => (
                    <div key={i} className="flex justify-between p-1.5 bg-muted/30 rounded">
                      <span>{station.name}</span>
                      <span className="text-muted-foreground">{station.distance ? `${station.distance}m` : ""} · {(station.modes || []).join(", ")}</span>
                    </div>
                  ))}
                </IntelligenceSection>
              )}
              {hasPdStats && (
                <IntelligenceSection icon={TrendingUp} title="Market Stats (PropertyData)">
                  <div className="grid grid-cols-2 gap-2">
                    {data.propertyDataCoUk["postcode-key-stats"].data.average_price && (
                      <div className="p-2 bg-muted/30 rounded">
                        <p className="text-muted-foreground">Avg Price</p>
                        <p className="font-semibold">£{Number(data.propertyDataCoUk["postcode-key-stats"].data.average_price).toLocaleString()}</p>
                      </div>
                    )}
                    {data.propertyDataCoUk["postcode-key-stats"].data.average_rent && (
                      <div className="p-2 bg-muted/30 rounded">
                        <p className="text-muted-foreground">Avg Rent (pcm)</p>
                        <p className="font-semibold">£{data.propertyDataCoUk["postcode-key-stats"].data.average_rent}</p>
                      </div>
                    )}
                    {data.propertyDataCoUk["postcode-key-stats"].data.average_yield && (
                      <div className="p-2 bg-muted/30 rounded">
                        <p className="text-muted-foreground">Avg Yield</p>
                        <p className="font-semibold">{data.propertyDataCoUk["postcode-key-stats"].data.average_yield}</p>
                      </div>
                    )}
                    {data.propertyDataCoUk["postcode-key-stats"].data.turnover && (
                      <div className="p-2 bg-muted/30 rounded">
                        <p className="text-muted-foreground">Annual Turnover</p>
                        <p className="font-semibold">{data.propertyDataCoUk["postcode-key-stats"].data.turnover}</p>
                      </div>
                    )}
                  </div>
                </IntelligenceSection>
              )}
            </div>
          </ScrollArea>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {hasFreeholds && (
              <div className={`p-2.5 rounded-lg space-y-0.5 ${aiMatch && aiMatch.confidence !== "none" && !property.titleNumber ? "bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800" : "bg-muted/30"}`} data-testid="intel-summary-ownership">
                <div className="flex items-center gap-1.5">
                  {aiMatch && !property.titleNumber ? <Sparkles className="w-3 h-3 text-green-500" /> : <FileSearch className="w-3 h-3 text-indigo-500" />}
                  <span className="text-[10px] text-muted-foreground font-medium">Land Titles</span>
                </div>
                <p className="text-sm font-bold">{freeholds.length} freehold{freeholds.length !== 1 ? "s" : ""}</p>
                {(() => {
                  const totalLeaseholds = freeholds.reduce((sum: number, fh: any) => sum + (fh.polygons?.[0]?.leaseholds || 0), 0);
                  return totalLeaseholds > 0 ? <p className="text-[10px] text-muted-foreground">{totalLeaseholds} leasehold{totalLeaseholds !== 1 ? "s" : ""}</p> : null;
                })()}
                <p className="text-[10px] text-muted-foreground">
                  {property.titleNumber ? `Selected: ${property.titleNumber}` : aiMatch?.titleNumber ? `AI match: ${aiMatch.titleNumber}` : aiMatchLoading ? "AI matching..." : "Click Full Report to select"}
                </p>
              </div>
            )}
            {hasEpc && (() => {
              const topEpc = data.epc[0];
              return (
                <div className="p-2.5 bg-muted/30 rounded-lg space-y-0.5" data-testid="intel-summary-epc">
                  <div className="flex items-center gap-1.5">
                    <Zap className="w-3 h-3 text-amber-500" />
                    <span className="text-[10px] text-muted-foreground font-medium">EPC Rating</span>
                  </div>
                  <p className="text-sm font-bold">{topEpc.ratingBand || topEpc.rating || "N/A"}</p>
                  <p className="text-[10px] text-muted-foreground">{data.epc.length} certificate{data.epc.length !== 1 ? "s" : ""} found</p>
                </div>
              );
            })()}
            {hasVoa && (() => {
              const topVoa = data.voaRatings[0];
              return (
                <div className="p-2.5 bg-muted/30 rounded-lg space-y-0.5" data-testid="intel-summary-voa">
                  <div className="flex items-center gap-1.5">
                    <Landmark className="w-3 h-3 text-blue-500" />
                    <span className="text-[10px] text-muted-foreground font-medium">Rateable Value</span>
                  </div>
                  <p className="text-sm font-bold">£{Number(topVoa.rateableValue || 0).toLocaleString()}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{topVoa.description || "VOA record"}</p>
                </div>
              );
            })()}
            <div className="p-2.5 bg-muted/30 rounded-lg space-y-0.5" data-testid="intel-summary-flood">
              <div className="flex items-center gap-1.5">
                <Droplets className="w-3 h-3 text-cyan-500" />
                <span className="text-[10px] text-muted-foreground font-medium">Flood Risk</span>
              </div>
              {hasFlood && data.floodRisk.activeFloods > 0 ? (
                <>
                  <p className="text-sm font-bold text-red-600">⚠ Active</p>
                  <p className="text-[10px] text-red-500">{data.floodRisk.activeFloods} warning(s)</p>
                </>
              ) : (
                <>
                  <p className="text-sm font-bold text-green-600">Low</p>
                  <p className="text-[10px] text-muted-foreground">No active warnings</p>
                </>
              )}
            </div>
            {hasTfl && (() => {
              const nearest = data.tflNearby.stations[0];
              return (
                <div className="p-2.5 bg-muted/30 rounded-lg space-y-0.5" data-testid="intel-summary-tfl">
                  <div className="flex items-center gap-1.5">
                    <Train className="w-3 h-3 text-purple-500" />
                    <span className="text-[10px] text-muted-foreground font-medium">Nearest Station</span>
                  </div>
                  <p className="text-sm font-bold truncate">{nearest.name}</p>
                  <p className="text-[10px] text-muted-foreground">{nearest.distance ? `${nearest.distance}m away` : ""}</p>
                </div>
              );
            })()}
            {hasPlanningApps && (
              <div className="p-2.5 bg-muted/30 rounded-lg space-y-0.5" data-testid="intel-summary-planning-apps">
                <div className="flex items-center gap-1.5">
                  <FileText className="w-3 h-3 text-blue-500" />
                  <span className="text-[10px] text-muted-foreground font-medium">Planning Apps</span>
                </div>
                <p className="text-sm font-bold">{planningApps.length} application{planningApps.length !== 1 ? "s" : ""}</p>
                <p className="text-[10px] text-muted-foreground">Last 10 years</p>
              </div>
            )}
            {hasPlanning && (
              <div className="p-2.5 bg-muted/30 rounded-lg space-y-0.5" data-testid="intel-summary-planning">
                <div className="flex items-center gap-1.5">
                  <ShieldAlert className="w-3 h-3 text-orange-500" />
                  <span className="text-[10px] text-muted-foreground font-medium">Planning</span>
                </div>
                <p className="text-sm font-bold">{Object.values(data.planningData).filter((v: any) => Array.isArray(v) && v.length > 0).length} designation(s)</p>
                <p className="text-[10px] text-muted-foreground">Heritage & conservation</p>
              </div>
            )}
            {hasListed && (
              <div className="p-2.5 bg-muted/30 rounded-lg space-y-0.5" data-testid="intel-summary-listed">
                <div className="flex items-center gap-1.5">
                  <Landmark className="w-3 h-3 text-rose-500" />
                  <span className="text-[10px] text-muted-foreground font-medium">Listed Buildings</span>
                </div>
                <p className="text-sm font-bold">{data.listedBuilding.length} nearby</p>
                <p className="text-[10px] text-muted-foreground">Grade {data.listedBuilding[0]?.grade}</p>
              </div>
            )}
            {hasPdStats && data.propertyDataCoUk["postcode-key-stats"].data.average_yield && (
              <div className="p-2.5 bg-muted/30 rounded-lg space-y-0.5" data-testid="intel-summary-yield">
                <div className="flex items-center gap-1.5">
                  <TrendingUp className="w-3 h-3 text-green-500" />
                  <span className="text-[10px] text-muted-foreground font-medium">Avg Yield</span>
                </div>
                <p className="text-sm font-bold">{data.propertyDataCoUk["postcode-key-stats"].data.average_yield}</p>
                <p className="text-[10px] text-muted-foreground">Postcode average</p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function PropertyNewsPanel({ propertyId, propertyName }: { propertyId: string; propertyName: string }) {
  const { data, isLoading, refetch, isFetching } = useQuery<{ articles: PropertyNewsArticle[]; searchQuery: string }>({
    queryKey: ["/api/properties", propertyId, "news"],
    queryFn: () => fetch(`/api/properties/${propertyId}/news`, { credentials: "include", headers: getAuthHeaders() }).then(r => r.json()),
    staleTime: 5 * 60 * 1000,
  });

  const articles = data?.articles || [];

  return (
    <Card data-testid="property-news-panel">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Newspaper className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">News Feed</span>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{propertyName}</Badge>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="button-refresh-news"
          >
            <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : articles.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Newspaper className="w-6 h-6 mx-auto mb-2 opacity-30" />
            <p className="text-xs">No news found for this property</p>
          </div>
        ) : (
          <ScrollArea className="max-h-[400px]">
            <div className="divide-y">
              {articles.map(article => (
                <a key={article.id} href={article.url} target="_blank" rel="noopener noreferrer" className="block" data-testid={`news-article-${article.id}`}>
                  <div className="flex gap-2.5 p-2 rounded-md hover:bg-muted/50 transition-colors cursor-pointer">
                    {article.imageUrl && (
                      <img
                        src={article.imageUrl}
                        alt=""
                        className="w-16 h-16 rounded object-cover shrink-0"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold leading-snug line-clamp-2">{article.title}</p>
                      {article.summary && (
                        <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{article.summary}</p>
                      )}
                      <div className="flex items-center gap-1.5 mt-1">
                        {article.sourceName && <span className="text-[10px] text-muted-foreground">{article.sourceName}</span>}
                        {article.publishedAt && (
                          <>
                            <span className="text-[10px] text-muted-foreground">·</span>
                            <span className="text-[10px] text-muted-foreground">{newsTimeAgo(article.publishedAt)}</span>
                          </>
                        )}
                        {article.source === "web" && (
                          <>
                            <span className="text-[10px] text-muted-foreground">·</span>
                            <Globe className="w-2.5 h-2.5 text-muted-foreground" />
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

export function Property360Panel({ propertyId }: { propertyId: string }) {
  const { data, isLoading } = useQuery<{
    comps: any[];
    deals: any[];
    news: any[];
    matchingRequirements: any[];
  }>({
    queryKey: ["/api/properties", propertyId, "360"],
    queryFn: async () => {
      const res = await fetch(`/api/properties/${propertyId}/360`, {
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!res.ok) return { comps: [], deals: [], news: [], matchingRequirements: [] };
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <Card data-testid="property-360">
        <CardContent className="p-4">
          <Skeleton className="h-6 w-48 mb-4" />
          <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
        </CardContent>
      </Card>
    );
  }

  const hasData = data && (data.comps.length > 0 || data.matchingRequirements.length > 0 || data.news.length > 0);
  if (!hasData) return null;

  return (
    <Card data-testid="property-360">
      <CardContent className="p-4 space-y-5">
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold">Property 360</h3>
        </div>

        {data!.matchingRequirements.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <FileText className="w-3.5 h-3.5 text-purple-500" />
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Matching Requirements</p>
              <Badge variant="secondary" className="text-[9px]">{data!.matchingRequirements.length}</Badge>
            </div>
            <div className="space-y-1">
              {data!.matchingRequirements.map((r: any) => (
                <Link key={r.id} href="/requirements">
                  <div className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 transition-colors cursor-pointer" data-testid={`match-req-${r.id}`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{r.name}</p>
                      <p className="text-[10px] text-muted-foreground">{r.company_name || "Unknown"} · {(r.use || []).join(", ") || "Any use"}</p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {data!.comps.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <TrendingUp className="w-3.5 h-3.5 text-orange-500" />
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Historical Comps</p>
              <Badge variant="secondary" className="text-[9px]">{data!.comps.length}</Badge>
            </div>
            <div className="space-y-1">
              {data!.comps.map((c: any) => (
                <Link key={c.id} href={`/comps/${c.id}`}>
                  <div className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50 transition-colors cursor-pointer" data-testid={`comp-${c.id}`}>
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate">{c.tenant || c.name}</p>
                      <p className="text-[10px] text-muted-foreground">{c.use_class || ""} · {c.completion_date || ""}</p>
                    </div>
                    {c.headline_rent && <span className="text-xs font-medium text-muted-foreground shrink-0">{c.headline_rent}</span>}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {data!.news.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Newspaper className="w-3.5 h-3.5 text-blue-500" />
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">News Mentions</p>
              <Badge variant="secondary" className="text-[9px]">{data!.news.length}</Badge>
            </div>
            <div className="space-y-1">
              {data!.news.map((n: any) => (
                <a key={n.id} href={n.url} target="_blank" rel="noopener noreferrer">
                  <div className="flex items-start gap-2 p-2 rounded-md hover:bg-muted/50 transition-colors cursor-pointer" data-testid={`news-${n.id}`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium leading-tight">{n.title}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{n.source_name || "News"}{n.published_at && !isNaN(new Date(n.published_at).getTime()) ? ` · ${new Date(n.published_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}</p>
                    </div>
                    <ExternalLink className="w-3 h-3 text-muted-foreground shrink-0 mt-0.5" />
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function LinkedLandRegistryPanel({ propertyId }: { propertyId: string }) {
  const { data: searches = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/land-registry/property-searches", propertyId],
    queryFn: async () => {
      const res = await fetch(`/api/land-registry/property-searches/${propertyId}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-2 py-2">
        <Skeleton className="h-4 w-full rounded" />
        <Skeleton className="h-4 w-3/4 rounded" />
      </div>
    );
  }

  if (searches.length === 0) {
    return (
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">No land registry searches linked.</p>
        <p className="text-xs text-muted-foreground italic">Link searches from the Land Registry page.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {searches.map((s: any) => {
        const summaryText = s.aiSummary?.summary || s.aiSummary?.executiveSummary || "";
        const truncated = summaryText.length > 100 ? summaryText.slice(0, 100) + "…" : summaryText;
        return (
          <a
            key={s.id}
            href={`/land-registry`}
            className="block p-2.5 rounded-lg border hover:bg-muted/50 transition-colors group"
          >
            <p className="text-xs font-medium truncate">{s.address}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {new Date(s.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
              {s.freeholdsCount > 0 && ` · ${s.freeholdsCount} freehold${s.freeholdsCount !== 1 ? "s" : ""}`}
              {s.leaseholdsCount > 0 && ` · ${s.leaseholdsCount} leasehold${s.leaseholdsCount !== 1 ? "s" : ""}`}
            </p>
            {truncated && <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">{truncated}</p>}
          </a>
        );
      })}
      <p className="text-[10px] text-muted-foreground italic px-0.5">Link additional searches from the Land Registry page.</p>
    </div>
  );
}

// PropertyDetail extracted to @/components/property-detail.tsx


export default function Properties() {
  const [, params] = useRoute("/properties/:id");
  const [search, setSearch] = useState("");
  const [activeGroup, setActiveGroup] = useState("all");
  const [columnFilters, setColumnFilters] = useState<Record<string, string[]>>({});
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const urlParams = new URLSearchParams(window.location.search);
  const teamParam = urlParams.get("team");

  if (params?.id) {
    return <PropertyDetail id={params.id} />;
  }

  return (
    <PropertiesList
      search={search}
      setSearch={setSearch}
      activeGroup={activeGroup}
      setActiveGroup={setActiveGroup}
      columnFilters={columnFilters}
      setColumnFilters={setColumnFilters}
      createDialogOpen={createDialogOpen}
      setCreateDialogOpen={setCreateDialogOpen}
      teamFilter={teamParam}
    />
  );
}

function PropertiesList({
  search,
  setSearch,
  activeGroup,
  setActiveGroup,
  columnFilters,
  setColumnFilters,
  createDialogOpen,
  setCreateDialogOpen,
  teamFilter,
}: {
  search: string;
  setSearch: (s: string) => void;
  activeGroup: string;
  setActiveGroup: (s: string) => void;
  columnFilters: Record<string, string[]>;
  setColumnFilters: (fn: (prev: Record<string, string[]>) => Record<string, string[]>) => void;
  createDialogOpen: boolean;
  setCreateDialogOpen: (open: boolean) => void;
  teamFilter?: string | null;
}) {
  const { toast } = useToast();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [activeView, setActiveView] = useState<"list" | "landlordHealth">("list");
  const [viewMode, setViewMode] = useState<"table" | "card" | "board">(
    typeof window !== "undefined" && window.innerWidth < 768 ? "card" : "table"
  );

  const bulkUpdateMutation = useMutation({
    mutationFn: async ({ ids, field, value }: { ids: string[]; field: string; value: any }) => {
      await apiRequest("POST", "/api/crm/properties/bulk-update", { ids, field, value });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/properties"] });
      setSelectedIds(new Set());
    },
    onError: (err: any) => {
      toast({ title: "Bulk update failed", description: err.message, variant: "destructive" });
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async ({ ids }: { ids: string[] }) => {
      await apiRequest("POST", "/api/crm/properties/bulk-delete", { ids });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/properties"] });
      setSelectedIds(new Set());
      toast({ title: "Deleted", description: `${selectedIds.size} properties deleted` });
    },
    onError: (err: any) => {
      toast({ title: "Bulk delete failed", description: err.message, variant: "destructive" });
    },
  });

  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>({
    landlord: true,
    status: true,
    assetClass: true,
    engagement: true,
    deals: true,
    tenants: true,
    agents: true,
    sqft: true,
    folderTree: true,
  });

  const COLUMN_LABELS: Record<string, string> = {
    landlord: "Ownership",
    status: "Status",
    assetClass: "Asset Class",
    engagement: "Team",
    deals: "WIP",
    tenants: "Tenants",
    agents: "BGP Contacts",
    sqft: "Sq Ft",
    folderTree: "Folder Tree",
  };

  const toggleColumn = (col: string) => {
    setVisibleColumns(prev => ({ ...prev, [col]: !prev[col] }));
  };

  const { data: properties, isLoading, error } = useQuery<CrmProperty[]>({
    queryKey: ["/api/crm/properties"],
    refetchInterval: (query) => {
      const items = query.state.data;
      if (!items?.length) return false;
      const hasEnriching = items.some(p => {
        if (!p.createdAt) return false;
        const ageMs = Date.now() - new Date(p.createdAt).getTime();
        return ageMs < 5 * 60 * 1000 && !(p.proprietorName || p.landlordId || p.titleNumber) && p.address;
      });
      return hasEnriching ? 15000 : false;
    },
  });

  const { data: allUsers = [] } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });
  const userColorMap = useMemo(() => buildUserColorMap(allUsers), [allUsers]);

  const { data: agentLinks = [] } = useQuery<{ propertyId: string; userId: string }[]>({
    queryKey: ["/api/crm/property-agents"],
  });

  const { data: allCompanies = [] } = useQuery<CrmCompany[]>({
    queryKey: ["/api/crm/companies"],
  });

  const { data: tenantLinks = [] } = useQuery<{ propertyId: string; companyId: string }[]>({
    queryKey: ["/api/crm/property-tenants"],
  });

  const { data: dealLinks = [] } = useQuery<DealLink[]>({
    queryKey: ["/api/crm/property-deal-links"],
  });

  const { data: allDealsRaw = [] } = useQuery<{ id: string; name: string; propertyId: string | null; status: string | null; groupName: string | null }[]>({
    queryKey: ["/api/crm/deals"],
    select: (data: any[]) => data.map((d: any) => ({ id: d.id, name: d.name, propertyId: d.propertyId, status: d.status, groupName: d.groupName })),
  });

  const inlineUpdateMutation = useMutation({
    mutationFn: async ({ id, field, value }: { id: string; field: string; value: any }) => {
      const updates: Record<string, any> = { [field]: value };
      if (field === "status") {
        const property = filteredItems.find(p => p.id === id);
        const currentTeams = Array.isArray(property?.bgpEngagement) ? [...property.bgpEngagement] : property?.bgpEngagement ? [property.bgpEngagement] : [];
        if (value === "Sales Instruction" && !currentTeams.includes("Investment")) {
          updates.bgpEngagement = [...currentTeams, "Investment"];
        } else if (value === "Lease Advisory Instruction" && !currentTeams.includes("Lease Advisory")) {
          updates.bgpEngagement = [...currentTeams, "Lease Advisory"];
        }
      }
      await apiRequest("PUT", `/api/crm/properties/${id}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/properties"] });
    },
    onError: (err: any) => {
      toast({
        title: "Update failed",
        description: err.message || "Could not save change",
        variant: "destructive",
      });
    },
  });

  const toggleFilter = (columnId: string, value: string) => {
    setColumnFilters((prev) => {
      const current = prev[columnId] || [];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { ...prev, [columnId]: next };
    });
  };

  const activeFilterCount = Object.values(columnFilters).reduce(
    (acc, arr) => acc + arr.length,
    0
  );

  const clearAllFilters = () => {
    setColumnFilters(() => ({}));
    setSearch("");
    setActiveGroup("all");
  };

  // --- Saved filter views (localStorage) ---
  const SAVED_VIEWS_KEY = "bgp_saved_property_views";
  type SavedView = { name: string; filters: { search: string; activeGroup: string; columnFilters: Record<string, string[]> } };

  const getSavedViews = useCallback((): SavedView[] => {
    try { return JSON.parse(localStorage.getItem(SAVED_VIEWS_KEY) || "[]"); } catch { return []; }
  }, []);

  const [savedViews, setSavedViews] = useState<SavedView[]>(getSavedViews);
  const [savedViewsOpen, setSavedViewsOpen] = useState(false);

  const handleSaveView = useCallback(() => {
    const name = window.prompt("Name this saved view:");
    if (!name?.trim()) return;
    const view: SavedView = {
      name: name.trim(),
      filters: { search, activeGroup, columnFilters },
    };
    const views = [...getSavedViews(), view];
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(views));
    setSavedViews(views);
    toast({ title: "View saved", description: `"${name.trim()}" has been saved.` });
  }, [search, activeGroup, columnFilters, getSavedViews, toast]);

  const handleApplyView = useCallback((view: SavedView) => {
    setSearch(view.filters.search || "");
    setActiveGroup(view.filters.activeGroup || "all");
    setColumnFilters(() => view.filters.columnFilters || {});
    setSavedViewsOpen(false);
    toast({ title: "View applied", description: `Applied "${view.name}".` });
  }, [toast]);

  const handleDeleteView = useCallback((idx: number) => {
    const views = getSavedViews().filter((_, i) => i !== idx);
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(views));
    setSavedViews(views);
    toast({ title: "View deleted" });
  }, [getSavedViews, toast]);
  // --- End saved filter views ---

  const { activeTeam } = useTeam();
  const isLandsecView = activeTeam === "Landsec";

  const landsecCompanyIds = useMemo(() => {
    if (!isLandsecView || !allCompanies) return null;
    const ids = new Set<string>();
    allCompanies.forEach(c => {
      const n = (c.name || "").toLowerCase().replace(/\s+/g, "");
      if (n === "landsec" || n === "landsecurities" || n.includes("landsec")) {
        ids.add(c.id);
      }
    });
    return ids.size > 0 ? ids : null;
  }, [isLandsecView, allCompanies]);

  const items = useMemo(() => {
    const all = properties || [];
    if (!isLandsecView || !landsecCompanyIds) return all;
    return all.filter(p => p.landlordId && landsecCompanyIds.has(p.landlordId));
  }, [properties, isLandsecView, landsecCompanyIds]);

  const statusValues = useMemo(() => {
    const s = new Set<string>();
    items.forEach((i) => { if (i.status) s.add(i.status); });
    return Array.from(s).sort();
  }, [items]);

  const assetClassValues = useMemo(() => {
    const s = new Set<string>();
    items.forEach((i) => {
      const vals = Array.isArray(i.assetClass) ? i.assetClass : i.assetClass ? [i.assetClass] : [];
      vals.forEach(v => s.add(v));
    });
    return Array.from(s).sort();
  }, [items]);

  const tenureValues = useMemo(() => {
    const s = new Set<string>();
    items.forEach((i) => { if (i.tenure) s.add(i.tenure); });
    return Array.from(s).sort();
  }, [items]);

  const engagementValues = useMemo(() => {
    // Canonical team list first, then any stray values from the data so the
    // user can still filter on legacy entries (e.g. "Hospitality", "USA").
    const canonical = [...CRM_OPTIONS.dealTeam];
    const canonicalSet = new Set(canonical);
    const stray = new Set<string>();
    items.forEach((i) => {
      const vals = Array.isArray(i.bgpEngagement) ? i.bgpEngagement : i.bgpEngagement ? [i.bgpEngagement] : [];
      vals.forEach(v => { if (v && !canonicalSet.has(v)) stray.add(v); });
    });
    return [...canonical, ...Array.from(stray).sort()];
  }, [items]);

  const teamUserIds = useMemo(() => {
    if (!teamFilter) return null;
    const tf = teamFilter.toLowerCase();
    return new Set(allUsers.filter(u => u.team?.toLowerCase().includes(tf)).map(u => String(u.id)));
  }, [teamFilter, allUsers]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (teamUserIds) {
        const assignedIds = agentLinks.filter(l => l.propertyId === item.id).map(l => l.userId);
        if (assignedIds.length > 0 && !assignedIds.some(id => teamUserIds.has(id))) return false;
      }
      if (activeGroup === "all" && HIDDEN_FROM_ALL.has(item.groupName || "")) return false;
      if (activeGroup === "Investment Comps" && !HIDDEN_FROM_ALL.has(item.groupName || "")) return false;
      if (activeGroup !== "all" && activeGroup !== "Investment Comps" && item.groupName !== activeGroup) return false;

      const statusFilters = columnFilters["status"] || [];
      if (statusFilters.length > 0 && (!item.status || !statusFilters.includes(item.status))) return false;

      const assetFilters = columnFilters["assetClass"] || [];
      if (assetFilters.length > 0) {
        const itemAssets = Array.isArray(item.assetClass) ? item.assetClass : item.assetClass ? [item.assetClass] : [];
        if (!itemAssets.some(a => assetFilters.includes(a))) return false;
      }

      const tenureFilters = columnFilters["tenure"] || [];
      if (tenureFilters.length > 0 && (!item.tenure || !tenureFilters.includes(item.tenure))) return false;

      const engagementFilters = columnFilters["engagement"] || [];
      if (engagementFilters.length > 0) {
        const itemEngagements = Array.isArray(item.bgpEngagement) ? item.bgpEngagement : item.bgpEngagement ? [item.bgpEngagement] : [];
        if (!itemEngagements.some(e => engagementFilters.includes(e))) return false;
      }

      if (search) {
        const s = search.toLowerCase();
        const nameMatch = item.name.toLowerCase().includes(s);
        const addrMatch = formatAddress(item.address).toLowerCase().includes(s);
        const assignedIds = agentLinks.filter(l => l.propertyId === item.id).map(l => l.userId);
        const agentNames = allUsers.filter(u => assignedIds.includes(String(u.id))).map(u => (u.name || "").toLowerCase());
        const agentMatch = agentNames.some(n => n.includes(s));
        if (!nameMatch && !addrMatch && !agentMatch) return false;
      }

      return true;
    });
  }, [items, activeGroup, columnFilters, search, agentLinks, allUsers, teamUserIds]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [activeGroup, search, columnFilters]);

  const groupCounts = useMemo(() => {
    return GROUP_TABS.filter((g) => g.id !== "all").map((g) => ({
      ...g,
      count: g.id === "Investment Comps"
        ? items.filter((i) => HIDDEN_FROM_ALL.has(i.groupName || "")).length
        : items.filter((i) => i.groupName === g.id).length,
    }));
  }, [items]);

  if (error) {
    return (
      <div className="p-4 sm:p-6">
        <div className="flex items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Properties</h1>
            <p className="text-sm text-muted-foreground">CRM Properties</p>
          </div>
        </div>
        <Card>
          <CardContent className="py-12 text-center">
            <AlertCircle className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <h3 className="font-medium mb-1">Could not load Properties</h3>
            <p className="text-sm text-muted-foreground">
              Unable to load properties. Please try again.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <PageLayout
      title="Properties"
      icon={Building2}
      subtitle={`${items.length} properties in the CRM${isLandsecView ? " · Landsec portfolio" : teamFilter ? ` · Filtered by ${teamFilter} team` : ""}`}
      actions={
        <>
          <Button
            variant={activeView === "landlordHealth" ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveView(v => v === "landlordHealth" ? "list" : "landlordHealth")}
            data-testid="button-landlord-health"
          >
            <ShieldAlert className="w-4 h-4 mr-2" />
            Landlord Health
          </Button>
          <Button
            onClick={() => setCreateDialogOpen(true)}
            data-testid="button-create-property"
          >
            <Plus className="w-4 h-4 mr-2" />
            New Property
          </Button>
        </>
      }
      className="space-y-6"
      testId="properties-page"
    >

      <CreatePropertyDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />

      {activeView === "landlordHealth" && (
        <LandlordHealthView
          properties={items}
          allCompanies={allCompanies}
          onClose={() => setActiveView("list")}
        />
      )}

      {activeView === "list" && <><div className="flex items-center gap-3 overflow-x-auto pb-1">
        {groupCounts.map((g) => (
          <Card
            key={g.id}
            className={`flex-1 min-w-[140px] cursor-pointer transition-colors ${
              activeGroup === g.id ? "border-primary bg-primary/5" : ""
            }`}
            onClick={() => setActiveGroup(activeGroup === g.id ? "all" : g.id)}
            data-testid={`card-group-${g.id.toLowerCase()}`}
          >
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-muted-foreground" />
                <div>
                  <p className="text-lg font-bold" data-testid={`text-group-count-${g.id.toLowerCase()}`}>{g.count}</p>
                  <p className="text-xs text-muted-foreground">{g.label}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        <Card
          className={`flex-1 min-w-[140px] cursor-pointer transition-colors ${
            activeGroup === "all" ? "border-primary bg-primary/5" : ""
          }`}
          onClick={() => setActiveGroup("all")}
          data-testid="card-group-all"
        >
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="text-lg font-bold" data-testid="text-group-count-all">{items.length}</p>
                <p className="text-xs text-muted-foreground">All</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search properties..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-search-properties"
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" data-testid="button-toggle-columns">
              <SlidersHorizontal className="w-3.5 h-3.5 mr-1.5" />
              Columns
              {Object.values(visibleColumns).filter(v => !v).length > 0 && (
                <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-[10px]">
                  {Object.values(visibleColumns).filter(v => v).length}/{Object.keys(visibleColumns).length}
                </Badge>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {Object.entries(COLUMN_LABELS).map(([key, label]) => (
              <DropdownMenuItem
                key={key}
                onClick={() => toggleColumn(key)}
                data-testid={`toggle-column-${key}`}
              >
                {visibleColumns[key] ? (
                  <Eye className="w-3.5 h-3.5 mr-2 text-foreground" />
                ) : (
                  <EyeOff className="w-3.5 h-3.5 mr-2 text-muted-foreground" />
                )}
                <span className={visibleColumns[key] ? "" : "text-muted-foreground"}>{label}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {(activeFilterCount > 0 || search || activeGroup !== "all") && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleSaveView}
            data-testid="button-save-view"
          >
            <Bookmark className="w-3.5 h-3.5 mr-1.5" />
            Save View
          </Button>
        )}
        {savedViews.length > 0 && (
          <Popover open={savedViewsOpen} onOpenChange={setSavedViewsOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" data-testid="button-saved-views">
                <BookmarkCheck className="w-3.5 h-3.5 mr-1.5" />
                Saved Views
                <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-[10px]">{savedViews.length}</Badge>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-2">
              <div className="space-y-1">
                {savedViews.map((view, idx) => (
                  <div key={idx} className="flex items-center justify-between rounded-md hover:bg-muted px-2 py-1.5 group">
                    <button
                      className="text-sm text-left flex-1 truncate"
                      onClick={() => handleApplyView(view)}
                      data-testid={`saved-view-${idx}`}
                    >
                      {view.name}
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                      onClick={(e) => { e.stopPropagation(); handleDeleteView(idx); }}
                      data-testid={`delete-saved-view-${idx}`}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        )}
        {(activeFilterCount > 0 || search || activeGroup !== "all") && (
          <Button
            variant="outline"
            size="sm"
            onClick={clearAllFilters}
            data-testid="button-clear-all-filters"
          >
            <X className="w-3.5 h-3.5 mr-1.5" />
            Clear all
            {activeFilterCount > 0 && (
              <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-[10px]">
                {activeFilterCount}
              </Badge>
            )}
          </Button>
        )}
        <ViewToggle view={viewMode} onToggle={setViewMode} />
      </div>

      {viewMode === "card" ? (
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-24 rounded-xl" />
                ))}
              </div>
            ) : (
              <MobileCardView
                items={filteredItems.map((item): MobileCardItem => {
                  const assignedIds = agentLinks.filter(l => l.propertyId === item.id).map(l => l.userId);
                  const agentNames = allUsers.filter(u => assignedIds.includes(String(u.id))).map(u => u.name || "").join(", ");
                  const teams = Array.isArray(item.bgpEngagement) ? item.bgpEngagement.join(", ") : (item.bgpEngagement || "");
                  const assetClass = Array.isArray(item.assetClass) ? item.assetClass.join(", ") : (item.assetClass || "");
                  return {
                    id: item.id,
                    title: item.name,
                    subtitle: item.address ? (typeof item.address === "object" ? (item.address as any).line1 || "" : String(item.address)) : undefined,
                    href: `/properties/${item.id}`,
                    status: item.status || undefined,
                    statusColor: BUILDING_ICON_COLORS[item.status || ""]?.replace("text-", "bg-") || "bg-muted-foreground",
                    fields: [
                      { label: "Asset Class", value: assetClass, badge: true },
                      { label: "Team", value: teams },
                      { label: "Tenure", value: item.tenure },
                      { label: "BGP Contacts", value: agentNames },
                      { label: "Sq Ft", value: item.sqft ? Number(item.sqft).toLocaleString() : null },
                    ],
                  };
                })}
                emptyMessage="No properties found"
                emptyIcon={Building2}
              />
            )}
          </CardContent>
        </Card>
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
            <ScrollableTable minWidth={2200}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px] px-2">
                      <Checkbox
                        data-testid="checkbox-select-all-properties"
                        checked={
                          filteredItems.length > 0 && filteredItems.every(i => selectedIds.has(i.id))
                            ? true
                            : filteredItems.some(i => selectedIds.has(i.id))
                              ? "indeterminate"
                              : false
                        }
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedIds(new Set(filteredItems.map(i => i.id)));
                          } else {
                            setSelectedIds(new Set());
                          }
                        }}
                      />
                    </TableHead>
                    <TableHead className="min-w-[280px] w-[280px]">Property</TableHead>
                    {visibleColumns.landlord && <TableHead className="min-w-[140px]">Ownership</TableHead>}
                    {visibleColumns.status && (
                      <TableHead className="min-w-[90px] w-[90px]">
                        <ColumnFilterPopover
                          label="Status"
                          options={statusValues}
                          activeFilters={columnFilters["status"] || []}
                          onToggleFilter={(val) => toggleFilter("status", val)}
                        />
                      </TableHead>
                    )}
                    {visibleColumns.assetClass && (
                      <TableHead className="min-w-[80px] w-[80px]">
                        <ColumnFilterPopover
                          label="Class"
                          options={assetClassValues}
                          activeFilters={columnFilters["assetClass"] || []}
                          onToggleFilter={(val) => toggleFilter("assetClass", val)}
                        />
                      </TableHead>
                    )}
                    {visibleColumns.engagement && (
                      <TableHead className="min-w-[140px]">
                        <ColumnFilterPopover
                          label="Team"
                          options={engagementValues}
                          activeFilters={columnFilters["engagement"] || []}
                          onToggleFilter={(val) => toggleFilter("engagement", val)}
                        />
                      </TableHead>
                    )}
                    {visibleColumns.deals && <TableHead className="min-w-[140px]">WIP</TableHead>}
                    {visibleColumns.tenants && <TableHead className="min-w-[140px]">Tenants</TableHead>}
                    {visibleColumns.agents && <TableHead className="min-w-[120px]">BGP Contacts</TableHead>}
                    {visibleColumns.sqft && <TableHead className="min-w-[60px] w-[60px]">Sq Ft</TableHead>}
                    {visibleColumns.folderTree && <TableHead className="min-w-[140px]">Folder Tree</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredItems.map((item) => (
                    <TableRow
                      key={item.id}
                      className="text-xs hover:bg-muted/50"
                      data-testid={`property-row-${item.id}`}
                    >
                      <TableCell className="px-1.5 py-1">
                        <Checkbox
                          data-testid={`checkbox-property-${item.id}`}
                          checked={selectedIds.has(item.id)}
                          onCheckedChange={(checked) => {
                            setSelectedIds(prev => {
                              const next = new Set(prev);
                              if (checked) {
                                next.add(item.id);
                              } else {
                                next.delete(item.id);
                              }
                              return next;
                            });
                          }}
                        />
                      </TableCell>
                      <TableCell className="px-1.5 py-1 font-medium text-sm">
                        <div className="flex items-center gap-2">
                          <Building2 className={`w-4 h-4 shrink-0 ${BUILDING_ICON_COLORS[item.status || ""] || "text-muted-foreground"}`} />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <Link href={`/properties/${item.id}`}>
                                <span className="hover:underline block cursor-pointer">{item.name}</span>
                              </Link>
                              {(() => {
                                if (!item.createdAt) return null;
                                const ageMs = Date.now() - new Date(item.createdAt).getTime();
                                const isRecent = ageMs < 5 * 60 * 1000;
                                const hasEnrichmentData = !!(item.proprietorName || item.landlordId || item.titleNumber);
                                if (isRecent && !hasEnrichmentData && item.address) {
                                  return (
                                    <span className="inline-flex items-center gap-1 text-[9px] text-purple-500 animate-pulse" data-testid={`enriching-${item.id}`}>
                                      <Loader2 className="w-2.5 h-2.5 animate-spin" />
                                      Enriching...
                                    </span>
                                  );
                                }
                                return null;
                              })()}
                            </div>
                            <div onClick={(e) => e.stopPropagation()}>
                              <InlineAddress
                                value={addressToResult(item.address)}
                                onSave={(result) => inlineUpdateMutation.mutate({ id: item.id, field: "address", value: resultToAddress(result) })}
                                placeholder="Set address"
                              />
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      {visibleColumns.landlord && (
                        <TableCell className="px-1.5 py-1" onClick={(e) => e.stopPropagation()}>
                          <div className="flex flex-col gap-0.5">
                            <InlineOwnerLink
                              propertyId={item.id}
                              companyId={(item as any).freeholderId}
                              fieldName="freeholderId"
                              label="Freeholder"
                              allCompanies={allCompanies}
                            />
                            <InlineOwnerLink
                              propertyId={item.id}
                              companyId={(item as any).longLeaseholderId}
                              fieldName="longLeaseholderId"
                              label="Long Leaseholder"
                              allCompanies={allCompanies}
                            />
                            <InlineOwnerLink
                              propertyId={item.id}
                              companyId={(item as any).seniorLenderId}
                              fieldName="seniorLenderId"
                              label="Senior Lender"
                              allCompanies={allCompanies}
                            />
                            <InlineOwnerLink
                              propertyId={item.id}
                              companyId={(item as any).juniorLenderId}
                              fieldName="juniorLenderId"
                              label="Junior Lender"
                              allCompanies={allCompanies}
                            />
                          </div>
                        </TableCell>
                      )}
                      {visibleColumns.status && (
                        <TableCell className="px-1.5 py-1" onClick={(e) => e.stopPropagation()}>
                          <InlineLabelSelect
                            value={item.status}
                            options={STATUS_OPTIONS}
                            colorMap={PROPERTY_STATUS_COLORS}
                            onSave={(val) => inlineUpdateMutation.mutate({ id: item.id, field: "status", value: val })}
                            placeholder="Set status"
                            compact
                          />
                        </TableCell>
                      )}
                      {visibleColumns.assetClass && (
                        <TableCell className="px-1.5 py-1" onClick={(e) => e.stopPropagation()}>
                          <InlineEngagement
                            value={item.assetClass}
                            options={ASSET_CLASS_OPTIONS}
                            colorMap={ASSET_CLASS_COLORS}
                            onSave={(val) => inlineUpdateMutation.mutate({ id: item.id, field: "assetClass", value: val })}
                            placeholder="Set class"
                          />
                        </TableCell>
                      )}
                      {visibleColumns.engagement && (
                        <TableCell className="px-1.5 py-1" onClick={(e) => e.stopPropagation()}>
                          <InlineEngagement
                            value={item.bgpEngagement}
                            options={TEAM_OPTIONS}
                            colorMap={TEAM_COLORS}
                            onSave={(val) => inlineUpdateMutation.mutate({ id: item.id, field: "bgpEngagement", value: val })}
                          />
                        </TableCell>
                      )}
                      {visibleColumns.deals && (
                        <TableCell className="px-1.5 py-1" onClick={(e) => e.stopPropagation()}>
                          <InlineDeals
                            propertyId={item.id}
                            dealLinks={dealLinks}
                            allDeals={allDealsRaw}
                          />
                        </TableCell>
                      )}
                      {visibleColumns.tenants && (
                        <TableCell className="px-1.5 py-1" onClick={(e) => e.stopPropagation()}>
                          <InlineTenants
                            propertyId={item.id}
                            tenantLinks={tenantLinks}
                            allCompanies={allCompanies}
                          />
                        </TableCell>
                      )}
                      {visibleColumns.agents && (
                        <TableCell className="px-1.5 py-1" onClick={(e) => e.stopPropagation()}>
                          <InlineAgents
                            propertyId={item.id}
                            agentLinks={agentLinks}
                            allUsers={allUsers}
                            colorMap={userColorMap}
                          />
                        </TableCell>
                      )}
                      {visibleColumns.sqft && (
                        <TableCell className="px-1.5 py-1" onClick={(e) => e.stopPropagation()}>
                          <InlineNumber
                            value={item.sqft}
                            onSave={(val) => inlineUpdateMutation.mutate({ id: item.id, field: "sqft", value: val })}
                            suffix=" sf"
                            className="text-xs"
                            data-testid={`inline-sqft-${item.id}`}
                          />
                        </TableCell>
                      )}
                      {visibleColumns.folderTree && (
                        <TableCell className="px-1.5 py-1" onClick={(e) => e.stopPropagation()}>
                          <InlineFolderTree
                            propertyId={item.id}
                            propertyName={item.name}
                            folderTeams={item.folderTeams}
                          />
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                  {filteredItems.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={2 + Object.values(visibleColumns).filter(v => v).length} className="text-center py-12 text-muted-foreground">
                        <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
                          <Building2 className="w-6 h-6 text-muted-foreground" />
                        </div>
                        <p className="text-sm font-semibold text-foreground">No properties found</p>
                        <p className="text-xs mt-1">Add a property or adjust your filters</p>
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

      {selectedIds.size > 0 && (
        <div
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-md border bg-background px-4 py-2 shadow-lg"
          data-testid="bulk-action-bar-properties"
        >
          <span className="text-sm font-medium" data-testid="text-selected-count-properties">
            {selectedIds.size} selected
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" data-testid="bulk-assign-team-properties">
                <Users className="w-3.5 h-3.5 mr-1.5" />
                Assign Team
                <ChevronDown className="w-3.5 h-3.5 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {TEAM_OPTIONS.map(team => (
                <DropdownMenuItem
                  key={team}
                  onClick={() => bulkUpdateMutation.mutate({ ids: Array.from(selectedIds), field: "bgpEngagement", value: [team] })}
                  data-testid={`bulk-team-option-${team.toLowerCase().replace(/[\s\/]/g, "-")}`}
                >
                  <Badge className={`text-[10px] px-1.5 py-0 text-white ${TEAM_COLORS[team] || "bg-gray-500"}`}>
                    {team}
                  </Badge>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setBulkDeleteOpen(true)}
            data-testid="bulk-delete-properties"
          >
            <Trash2 className="w-3.5 h-3.5 mr-1.5" />
            Delete
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSelectedIds(new Set())}
            data-testid="bulk-clear-properties"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      )}

      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedIds.size} properties?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the selected properties.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                bulkDeleteMutation.mutate({ ids: Array.from(selectedIds) });
                setBulkDeleteOpen(false);
              }}
              data-testid="confirm-bulk-delete-properties"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </>}

    </PageLayout>
  );
}

// ── Landlord Health View ──────────────────────────────────────────────────────

function LandlordHealthView({
  properties,
  allCompanies,
  onClose,
}: {
  properties: CrmProperty[];
  allCompanies: any[];
  onClose: () => void;
}) {
  const [healthSearch, setHealthSearch] = useState("");
  const [healthFilter, setHealthFilter] = useState<"all" | "missing_billing" | "missing_parent" | "missing_both" | "ok">("all");
  const { toast } = useToast();

  const queryClient_local = useQueryClient();

  const updateMutation = useMutation({
    mutationFn: async ({ id, billingEntityId }: { id: string; billingEntityId: string }) => {
      await apiRequest("PUT", `/api/crm/properties/${id}`, { billingEntityId });
    },
    onSuccess: () => {
      queryClient_local.invalidateQueries({ queryKey: ["/api/crm/properties"] });
      toast({ title: "Billing entity updated" });
    },
    onError: (err: any) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  // Only properties with a landlord
  const withLandlord = properties.filter(p => p.landlordId);

  const rows = withLandlord.map(p => {
    const landlord = allCompanies.find(c => c.id === p.landlordId);
    const billingEntity = allCompanies.find(c => c.id === p.billingEntityId);
    const parentCompany = landlord?.parentCompanyId ? allCompanies.find(c => c.id === landlord.parentCompanyId) : null;

    const hasBilling = !!p.billingEntityId;
    const hasParent = !!parentCompany;
    const landlordIsSPV = landlord && (
      /\b(limited|ltd|llp|llc|nominees|nominee|holdings|holding|spv|realty|properties|developments|plc)\b/i.test(landlord.name) &&
      !/^(grosvenor|landsec|hammerson|british land|derwent|great portland|canary wharf|crown estate|cadogan|longmartin)/i.test(landlord.name)
    );

    let status: "ok" | "missing_billing" | "missing_parent" | "missing_both" = "ok";
    if (!hasBilling && !hasParent) status = "missing_both";
    else if (!hasBilling) status = "missing_billing";
    else if (!hasParent) status = "missing_parent";

    return { property: p, landlord, billingEntity, parentCompany, hasBilling, hasParent, landlordIsSPV, status };
  });

  const filtered = rows.filter(r => {
    const matchesSearch = !healthSearch || r.property.name.toLowerCase().includes(healthSearch.toLowerCase()) ||
      r.landlord?.name?.toLowerCase().includes(healthSearch.toLowerCase());
    const matchesFilter = healthFilter === "all" || r.status === healthFilter;
    return matchesSearch && matchesFilter;
  });

  const counts = {
    all: rows.length,
    ok: rows.filter(r => r.status === "ok").length,
    missing_billing: rows.filter(r => r.status === "missing_billing").length,
    missing_parent: rows.filter(r => r.status === "missing_parent").length,
    missing_both: rows.filter(r => r.status === "missing_both").length,
  };

  const landlordCompanies = allCompanies.filter(c =>
    c.companyType === "Landlord" || c.companyType === "Client" || c.companyType === "Landlord / Client"
  );

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { key: "all", label: "All Landlord Properties", color: "bg-blue-50 border-blue-200", text: "text-blue-700" },
          { key: "ok", label: "✅ Fully Set Up", color: "bg-green-50 border-green-200", text: "text-green-700" },
          { key: "missing_billing", label: "⚠️ Missing Billing Entity", color: "bg-amber-50 border-amber-200", text: "text-amber-700" },
          { key: "missing_parent", label: "⚠️ Missing Parent Brand", color: "bg-orange-50 border-orange-200", text: "text-orange-700" },
          { key: "missing_both", label: "🔴 Missing Both", color: "bg-red-50 border-red-200", text: "text-red-700" },
        ].map(item => (
          <Card
            key={item.key}
            className={`cursor-pointer border ${item.color} ${healthFilter === item.key ? "ring-2 ring-primary" : ""}`}
            onClick={() => setHealthFilter(item.key as any)}
          >
            <CardContent className="p-3">
              <p className={`text-lg font-bold ${item.text}`}>{counts[item.key as keyof typeof counts]}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{item.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Explanation banner */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
        <strong>How this works:</strong> Each property should have (1) a <strong>Landlord / Client</strong> — the real relationship brand (e.g. Landsec, AEW, Grosvenor),
        and (2) a <strong>Billing Entity</strong> — the SPV/shell company used for invoicing (e.g. LS Tottenham Court Road Limited).
        Contacts, emails and calendar invites should always be linked to the Parent Brand.
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search properties or landlords..."
          className="pl-9"
          value={healthSearch}
          onChange={e => setHealthSearch(e.target.value)}
        />
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <ScrollableTable minWidth={900}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[200px]">Property</TableHead>
                  <TableHead className="min-w-[160px]">Landlord / Client</TableHead>
                  <TableHead className="min-w-[160px]">Parent Brand</TableHead>
                  <TableHead className="min-w-[160px]">Billing Entity</TableHead>
                  <TableHead className="min-w-[80px]">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(({ property, landlord, billingEntity, parentCompany, hasBilling, hasParent, status }) => (
                  <TableRow key={property.id} className="hover:bg-muted/30">
                    <TableCell className="py-2 px-3">
                      <a href={`/properties/${property.id}`} className="font-medium text-sm hover:underline text-primary">
                        {property.name}
                      </a>
                      {(property.address as any)?.city && (
                        <p className="text-xs text-muted-foreground">{(property.address as any).city}</p>
                      )}
                    </TableCell>
                    <TableCell className="py-2 px-3">
                      {landlord ? (
                        <a href={`/companies/${landlord.id}`} className="text-sm hover:underline text-foreground">
                          {landlord.name}
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">Not set</span>
                      )}
                    </TableCell>
                    <TableCell className="py-2 px-3">
                      {parentCompany ? (
                        <Badge className="bg-blue-100 text-blue-800 text-xs font-normal">
                          {parentCompany.name}
                        </Badge>
                      ) : (
                        <span className="text-xs text-amber-600 italic">⚠️ Not linked</span>
                      )}
                    </TableCell>
                    <TableCell className="py-2 px-3">
                      {billingEntity ? (
                        <Badge className="bg-amber-100 text-amber-800 text-xs font-normal">
                          {billingEntity.name}
                        </Badge>
                      ) : landlord ? (
                        <Select
                          onValueChange={(val) => updateMutation.mutate({ id: property.id, billingEntityId: val })}
                        >
                          <SelectTrigger className="h-7 text-xs w-40 border-dashed border-amber-400 text-amber-600">
                            <SelectValue placeholder="Set billing entity..." />
                          </SelectTrigger>
                          <SelectContent>
                            {/* The landlord itself is often the billing entity if it IS the SPV */}
                            <SelectItem value={landlord.id}>{landlord.name} (current landlord)</SelectItem>
                            {landlordCompanies
                              .filter(c => c.id !== landlord.id)
                              .slice(0, 30)
                              .map(c => (
                                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">—</span>
                      )}
                    </TableCell>
                    <TableCell className="py-2 px-3">
                      {status === "ok" && <Badge className="bg-green-100 text-green-700 text-xs">✅ OK</Badge>}
                      {status === "missing_billing" && <Badge className="bg-amber-100 text-amber-700 text-xs">⚠️ No Billing</Badge>}
                      {status === "missing_parent" && <Badge className="bg-orange-100 text-orange-700 text-xs">⚠️ No Parent</Badge>}
                      {status === "missing_both" && <Badge className="bg-red-100 text-red-700 text-xs">🔴 Missing Both</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      <ShieldAlert className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">No properties match this filter</p>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollableTable>
        </CardContent>
      </Card>
    </div>
  );
}

export function StreetViewCard({ address, propertyName }: { address: string; propertyName: string }) {
  const [heading, setHeading] = useState(0);

  if (!address) return null;

  const params = new URLSearchParams({ location: address, heading: String(heading), pitch: "5", fov: "90", size: "600x300" });
  const streetViewUrl = `/api/image-studio/streetview-proxy?${params}`;

  return (
    <Card data-testid="card-street-view">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Camera className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-xs text-muted-foreground font-medium">Street View</p>
          </div>
          <Link href={`/image-studio?property=${encodeURIComponent(propertyName)}&address=${encodeURIComponent(address)}`}>
            <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" data-testid="button-open-image-studio-sv">
              <ImageIcon className="h-3 w-3" /> Open in Image Studio
            </Button>
          </Link>
        </div>
        <div className="relative rounded-lg overflow-hidden">
          <img src={streetViewUrl} alt={`Street view of ${address}`} className="w-full h-auto rounded-lg" loading="lazy" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">Rotate:</span>
          {[0, 90, 180, 270].map((h) => (
            <Button key={h} variant={heading === h ? "default" : "outline"} size="sm" className="h-5 text-[10px] px-2" onClick={() => setHeading(h)} data-testid={`button-heading-${h}`}>
              {h}°
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
