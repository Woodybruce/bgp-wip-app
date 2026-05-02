import { useQuery, useMutation } from "@tanstack/react-query";
import { ScrollableTable } from "@/components/scrollable-table";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Building2, AlertCircle, ExternalLink, X, Handshake, FolderTree, Loader2, CheckCircle2, FolderOpen, ChevronRight, FileText, Plus, Star } from "lucide-react";
import { useState, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Link, useLocation } from "wouter";
import { apiRequest, queryClient, invalidateDealCaches } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { CrmProperty, CrmDeal, CrmCompany, User } from "@shared/schema";
import { InlineText, InlineSelect, InlineLabelSelect, InlineNumber } from "@/components/inline-edit";
import { CRM_OPTIONS } from "@/lib/crm-options";
import { useTeam } from "@/lib/team-context";
import { ColumnFilterPopover } from "@/components/column-filter-popover";

function isInstruction(property: CrmProperty): boolean {
  const status = (property.status || "");
  return status === "Leasing Instruction" || status === "Lease Advisory Instruction" || status === "Sales Instruction";
}

function getInstructionType(property: CrmProperty): "Leasing" | "Sale" | "Lease Advisory" {
  const status = (property.status || "");
  if (status === "Sales Instruction") return "Sale";
  if (status === "Lease Advisory Instruction") return "Lease Advisory";
  return "Leasing";
}

const STATUS_OPTIONS = ["BGP Active", "BGP Targeting", "Leasing Instruction", "Lease Advisory Instruction", "Sales Instruction", "Archive"];
const PROPERTY_STATUS_COLORS: Record<string, string> = {
  "BGP Active": "bg-emerald-500",
  "BGP Targeting": "bg-amber-500",
  "Leasing Instruction": "bg-blue-500",
  "Lease Advisory Instruction": "bg-violet-500",
  "Sales Instruction": "bg-emerald-600",
  "Archive": "bg-zinc-400",
};
const ASSET_CLASS_OPTIONS = ["Retail", "Office", "Industrial", "Mixed Use", "F&B", "Leisure", "Residential"];
const ASSET_CLASS_COLORS: Record<string, string> = {
  "Retail": "bg-blue-500",
  "Office": "bg-violet-500",
  "Industrial": "bg-amber-500",
  "Mixed Use": "bg-teal-500",
  "F&B": "bg-rose-500",
  "Leisure": "bg-emerald-500",
  "Residential": "bg-sky-500",
};
const TENURE_OPTIONS = ["Freehold", "Leasehold", "Virtual Freehold"];
const TENURE_COLORS: Record<string, string> = {
  "Freehold": "bg-indigo-500",
  "Leasehold": "bg-orange-500",
  "Virtual Freehold": "bg-cyan-500",
};
const TEAM_OPTIONS = CRM_OPTIONS.dealTeam;
const TEAM_COLORS: Record<string, string> = {
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

function getInitials(name: string): string {
  return name.split(" ").map(p => p[0]).join("").toUpperCase().slice(0, 2);
}

function InlineEngagement({
  value,
  options,
  colorMap,
  onSave,
}: {
  value: string[] | string | null;
  options: string[];
  colorMap: Record<string, string>;
  onSave: (val: string[]) => void;
}) {
  const current: string[] = Array.isArray(value) ? value : value ? [value] : [];
  const toggle = (option: string) => {
    const next = current.includes(option) ? current.filter(v => v !== option) : [...current, option];
    onSave(next);
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="flex items-center gap-1 flex-wrap min-h-[20px]" data-testid="inline-engagement-trigger">
          {current.length === 0 ? (
            <span className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
              <Plus className="w-3 h-3" />
              Set team
            </span>
          ) : (
            current.map(v => (
              <Badge key={v} className={`text-[10px] px-1.5 py-0 text-white ${colorMap[v] || "bg-gray-500"}`}>{v}</Badge>
            ))
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {options.map(option => (
          <DropdownMenuItem key={option} onClick={() => toggle(option)} data-testid={`engagement-option-${option}`}>
            <div className={`w-3 h-3 rounded-sm border mr-2 flex items-center justify-center ${current.includes(option) ? colorMap[option] || "bg-gray-500" : "border-muted-foreground/30"}`}>
              {current.includes(option) && <span className="text-white text-[8px]">✓</span>}
            </div>
            <Badge className={`text-[10px] px-1.5 py-0 text-white ${colorMap[option] || "bg-gray-500"}`}>{option}</Badge>
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

function InlineAgents({
  propertyId,
  agentLinks,
  allUsers,
}: {
  propertyId: string;
  agentLinks: { propertyId: string; userId: string }[];
  allUsers: User[];
}) {
  const { toast } = useToast();
  const assignedUserIds = agentLinks.filter(l => l.propertyId === propertyId).map(l => String(l.userId));
  const assignedUsers = allUsers.filter(u => assignedUserIds.includes(String(u.id)));
  const unassignedUsers = allUsers.filter(u => !assignedUserIds.includes(String(u.id)));

  const addMutation = useMutation({
    mutationFn: async (userId: string) => {
      await apiRequest("POST", `/api/crm/properties/${propertyId}/agents`, { userId });
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/crm/property-agents"] }); },
    onError: (err: any) => { toast({ title: "Failed to assign agent", description: err.message, variant: "destructive" }); },
  });

  const removeMutation = useMutation({
    mutationFn: async (userId: string) => {
      await apiRequest("DELETE", `/api/crm/properties/${propertyId}/agents/${userId}`);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/crm/property-agents"] }); },
    onError: (err: any) => { toast({ title: "Failed to remove agent", description: err.message, variant: "destructive" }); },
  });

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {assignedUsers.map(user => (
        <span key={user.id} className="inline-flex items-center gap-0.5">
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0" data-testid={`agent-badge-${propertyId}-${user.id}`}>
            {user.name.split(" ")[0]}
          </Badge>
          <button className="w-3.5 h-3.5 rounded-full hover:bg-destructive/20 flex items-center justify-center" onClick={() => removeMutation.mutate(String(user.id))} data-testid={`remove-agent-${propertyId}-${user.id}`}>
            <X className="w-2.5 h-2.5 text-muted-foreground hover:text-destructive" />
          </button>
        </span>
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="w-5 h-5 rounded-full border border-dashed border-muted-foreground/40 flex items-center justify-center hover:border-primary hover:bg-muted transition-colors" data-testid={`add-agent-${propertyId}`}>
            <Plus className="w-3 h-3 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-60 overflow-y-auto">
          {unassignedUsers.length === 0 ? (
            <DropdownMenuItem disabled>All team members assigned</DropdownMenuItem>
          ) : (
            unassignedUsers.map(user => (
              <DropdownMenuItem key={user.id} onClick={() => addMutation.mutate(String(user.id))} data-testid={`assign-agent-${user.id}`}>
                <div className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[9px] font-medium mr-2">
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

function InlineLandlord({
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
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/crm/properties"] }); },
    onError: (err: any) => { toast({ title: "Failed to update landlord", description: err.message, variant: "destructive" }); },
  });

  if (landlord) {
    return (
      <div className="flex items-center gap-1">
        <Link href={`/companies/${landlord.id}`}>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 cursor-pointer hover:bg-muted" data-testid={`landlord-badge-${propertyId}`}>
            <Building2 className="w-2.5 h-2.5 mr-0.5 text-muted-foreground" />
            {landlord.name}
          </Badge>
        </Link>
        <button className="w-3.5 h-3.5 rounded-full hover:bg-destructive/20 flex items-center justify-center" onClick={() => updateMutation.mutate(null)} data-testid={`remove-landlord-${propertyId}`}>
          <X className="w-2.5 h-2.5 text-muted-foreground hover:text-destructive" />
        </button>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1" data-testid={`set-landlord-${propertyId}`}>
          <Plus className="w-3 h-3" />
          Set landlord
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <div className="p-2">
          <Input placeholder="Search companies..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="h-7 text-xs" data-testid={`search-landlord-${propertyId}`} />
        </div>
        <div className="max-h-48 overflow-y-auto">
          {filteredCompanies.length === 0 ? (
            <DropdownMenuItem disabled>No companies found</DropdownMenuItem>
          ) : (
            filteredCompanies.map(company => (
              <DropdownMenuItem key={company.id} onClick={() => { updateMutation.mutate(company.id); setSearchTerm(""); }} data-testid={`assign-landlord-${company.id}`}>
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

type DealLink = { id: string; name: string; propertyId: string | null; status: string | null; groupName: string | null };

function InlineDeals({
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
      invalidateDealCaches();
    },
    onError: (err: any) => { toast({ title: "Failed to link deal", description: err.message, variant: "destructive" }); },
  });

  const unlinkMutation = useMutation({
    mutationFn: async (dealId: string) => {
      await apiRequest("PUT", `/api/crm/deals/${dealId}`, { propertyId: null });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/property-deal-links"] });
      invalidateDealCaches();
    },
    onError: (err: any) => { toast({ title: "Failed to unlink deal", description: err.message, variant: "destructive" }); },
  });

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {linkedDeals.map(deal => (
        <div key={deal.id} className="flex items-center gap-0.5">
          <Link href={`/deals/${deal.id}`}>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 cursor-pointer hover:bg-muted" data-testid={`deal-badge-${deal.id}`}>
              <Handshake className="w-2.5 h-2.5 mr-0.5 text-muted-foreground" />
              {deal.name}
            </Badge>
          </Link>
          <button className="w-3.5 h-3.5 rounded-full hover:bg-destructive/20 flex items-center justify-center" onClick={() => unlinkMutation.mutate(deal.id)} data-testid={`remove-deal-${deal.id}`}>
            <X className="w-2.5 h-2.5 text-muted-foreground hover:text-destructive" />
          </button>
        </div>
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="w-5 h-5 rounded-full border border-dashed border-muted-foreground/30 hover:border-foreground/50 flex items-center justify-center transition-colors" data-testid={`add-deal-${propertyId}`}>
            <Plus className="w-3 h-3 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <div className="p-2">
            <Input placeholder="Search deals..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="h-7 text-xs" data-testid={`search-deal-${propertyId}`} />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filteredDeals.length === 0 ? (
              <DropdownMenuItem disabled>No deals found</DropdownMenuItem>
            ) : (
              filteredDeals.map(deal => (
                <DropdownMenuItem key={deal.id} onClick={() => { linkMutation.mutate(deal.id); setSearchTerm(""); }} data-testid={`assign-deal-${deal.id}`}>
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

function InlineTenants({
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
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/crm/property-tenants"] }); },
    onError: (err: any) => { toast({ title: "Failed to add tenant", description: err.message, variant: "destructive" }); },
  });

  const removeMutation = useMutation({
    mutationFn: async (companyId: string) => {
      await apiRequest("DELETE", `/api/crm/properties/${propertyId}/tenants/${companyId}`);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/crm/property-tenants"] }); },
    onError: (err: any) => { toast({ title: "Failed to remove tenant", description: err.message, variant: "destructive" }); },
  });

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {assignedCompanies.map(company => (
        <span key={company.id} className="inline-flex items-center gap-0.5">
          <Link href={`/companies/${company.id}`}>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 cursor-pointer hover:bg-muted group" data-testid={`tenant-badge-${propertyId}-${company.id}`}>
              <Building2 className="w-2.5 h-2.5 mr-0.5 text-muted-foreground" />
              {company.name}
            </Badge>
          </Link>
          <button className="w-3.5 h-3.5 rounded-full hover:bg-destructive/20 flex items-center justify-center" onClick={() => removeMutation.mutate(company.id)} data-testid={`remove-tenant-${propertyId}-${company.id}`}>
            <X className="w-2.5 h-2.5 text-muted-foreground hover:text-destructive" />
          </button>
        </span>
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="w-5 h-5 rounded-full border border-dashed border-muted-foreground/40 flex items-center justify-center hover:border-primary hover:bg-muted transition-colors" data-testid={`add-tenant-${propertyId}`}>
            <Plus className="w-3 h-3 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <div className="p-2">
            <Input placeholder="Search companies..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="h-7 text-xs" data-testid={`search-tenant-${propertyId}`} />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filteredUnassigned.length === 0 ? (
              <DropdownMenuItem disabled>No companies found</DropdownMenuItem>
            ) : (
              filteredUnassigned.map(company => (
                <DropdownMenuItem key={company.id} onClick={() => { addMutation.mutate(company.id); setSearchTerm(""); }} data-testid={`assign-tenant-${company.id}`}>
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
        <FolderOpen className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs">{node.name}</span>
      </div>
      {node.children.map((child: any) => (
        <TreeNode key={child.name} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

function SetUpFoldersDialog({
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
                        : "border-border hover:bg-accent"
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

function PropertyFoldersPanel({ propertyName, folderTeams }: { propertyName: string; folderTeams?: string[] | null }) {
  const { data: currentUser } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const userTeam = currentUser?.team || "Investment";
  const teamsToCheck = folderTeams && folderTeams.length > 0 ? folderTeams : [userTeam];
  const [activeTeamName, setActiveTeamName] = useState<string | null>(null);
  const activeTeam = activeTeamName && teamsToCheck.includes(activeTeamName) ? activeTeamName : teamsToCheck[0] || userTeam;
  const activeTeamIdx = teamsToCheck.indexOf(activeTeam);

  const { data: folderData, isLoading } = useQuery<{ exists: boolean; folders: PropertyFolderItem[]; path?: string }>({
    queryKey: ["/api/microsoft/property-folders", activeTeam, propertyName],
    queryFn: async () => {
      const res = await fetch(`/api/microsoft/property-folders/${encodeURIComponent(activeTeam)}/${encodeURIComponent(propertyName)}`, { credentials: "include" });
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
                className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent transition-colors group"
                data-testid={`folder-item-${folder.id}`}
              >
                <FolderOpen className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                <span className="text-xs flex-1 truncate">{folder.name}</span>
                {folder.childCount > 0 && (
                  <span className="text-[10px] text-muted-foreground">{folder.childCount}</span>
                )}
                <ExternalLink className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
              </a>
            ))}
            {folderData.folders.filter(f => !f.isFolder).map((file) => (
              <a
                key={file.id}
                href={file.webUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent transition-colors group"
                data-testid={`file-item-${file.id}`}
              >
                <FileText className="w-3.5 h-3.5 text-muted-foreground/60 flex-shrink-0" />
                <span className="text-xs flex-1 truncate">{file.name}</span>
                <ExternalLink className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
              </a>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LinkedDealsPanel({ propertyId }: { propertyId: string }) {
  const { data: deals, isLoading } = useQuery<CrmDeal[]>({
    queryKey: ["/api/crm/properties", propertyId, "deals"],
    queryFn: async () => {
      const res = await fetch(`/api/crm/properties/${propertyId}/deals`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load linked deals");
      return res.json();
    },
  });

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

  const dealsList = deals || [];

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
                className="block p-3 rounded-md border hover:bg-accent transition-colors group"
                data-testid={`deal-item-${deal.id}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium truncate">{deal.name}</span>
                  <ExternalLink className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                </div>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  {deal.groupName && (
                    <Badge variant="secondary" className="text-[10px]">
                      {deal.groupName}
                    </Badge>
                  )}
                  {deal.status && (
                    <Badge variant="outline" className="text-[10px]">
                      {deal.status}
                    </Badge>
                  )}
                  {deal.internalAgent && (
                    <span className="text-[10px] text-muted-foreground">{deal.internalAgent}</span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Instructions() {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "leasing" | "lease_advisory" | "sale">("all");

  return (
    <InstructionsList
      search={search}
      setSearch={setSearch}
      typeFilter={typeFilter}
      setTypeFilter={setTypeFilter}
    />
  );
}

function InstructionsList({
  search,
  setSearch,
  typeFilter,
  setTypeFilter,
}: {
  search: string;
  setSearch: (s: string) => void;
  typeFilter: "all" | "leasing" | "lease_advisory" | "sale";
  setTypeFilter: (s: "all" | "leasing" | "lease_advisory" | "sale") => void;
}) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { activeTeam } = useTeam();
  const [columnFilters, setColumnFilters] = useState<Record<string, string[]>>({});
  const { data: currentUser } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const userTeam = currentUser?.team || null;
  const { data: properties, isLoading, error } = useQuery<CrmProperty[]>({
    queryKey: ["/api/crm/properties"],
  });

  const { data: favoriteIds = [] } = useQuery<string[]>({
    queryKey: ["/api/favorite-instructions"],
  });

  const toggleFavoriteMutation = useMutation({
    mutationFn: async (propertyId: string) => {
      const isFav = favoriteIds.includes(propertyId);
      if (isFav) {
        await apiRequest("DELETE", `/api/favorite-instructions/${propertyId}`);
      } else {
        await apiRequest("POST", `/api/favorite-instructions/${propertyId}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/favorite-instructions"] });
    },
  });

  const { data: agentLinks = [] } = useQuery<{ propertyId: string; userId: string }[]>({
    queryKey: ["/api/crm/property-agents"],
  });

  const { data: allUsers = [] } = useQuery<User[]>({
    queryKey: ["/api/users"],
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
      await apiRequest("PUT", `/api/crm/properties/${id}`, { [field]: value });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/properties"] });
    },
    onError: (err: any) => {
      toast({ title: "Update failed", description: err.message || "Could not save change", variant: "destructive" });
    },
  });

  const handleInlineSave = useCallback((id: string, field: string, value: any) => {
    inlineUpdateMutation.mutate({ id, field, value });
  }, [inlineUpdateMutation]);

  const toggleColumnFilter = useCallback((column: string, value: string) => {
    setColumnFilters(prev => {
      const current = prev[column] || [];
      const next = current.includes(value)
        ? current.filter(v => v !== value)
        : [...current, value];
      return { ...prev, [column]: next };
    });
  }, []);

  const clearAllFilters = () => {
    setSearch("");
    setTypeFilter("all");
    setColumnFilters({});
  };

  const hasColumnFilters = Object.values(columnFilters).some(f => f.length > 0);

  const getPropertyTeams = useCallback((property: CrmProperty): string[] => {
    const engagements = Array.isArray(property.bgpEngagement) ? property.bgpEngagement : property.bgpEngagement ? [property.bgpEngagement] : [];
    return engagements.filter((e: string) => e !== "BGP");
  }, []);

  if (error) {
    return (
      <div className="p-4 sm:p-6">
        <div className="flex items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Instructions</h1>
            <p className="text-sm text-muted-foreground">Properties with active instructions</p>
          </div>
        </div>
        <Card>
          <CardContent className="py-12 text-center">
            <AlertCircle className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <h3 className="font-medium mb-1">Could not load Instructions</h3>
            <p className="text-sm text-muted-foreground">
              Unable to load properties data. Please try again.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const allProperties = properties || [];
  const allInstructionProperties = allProperties.filter(isInstruction);

  const effectiveTeam = activeTeam && activeTeam !== "all" ? activeTeam : (userTeam || null);

  const instructionProperties = useMemo(() => {
    if (!effectiveTeam) return allInstructionProperties;
    return allInstructionProperties.filter((p) => {
      const teams = getPropertyTeams(p);
      if (effectiveTeam === "Unassigned") return teams.length === 0;
      return teams.includes(effectiveTeam);
    });
  }, [allInstructionProperties, effectiveTeam, getPropertyTeams]);

  const leasingCount = instructionProperties.filter(
    (p) => getInstructionType(p) === "Leasing"
  ).length;
  const leaseAdvisoryCount = instructionProperties.filter(
    (p) => getInstructionType(p) === "Lease Advisory"
  ).length;
  const saleCount = instructionProperties.filter(
    (p) => getInstructionType(p) === "Sale"
  ).length;

  const filteredProperties = instructionProperties.filter((p) => {
    if (typeFilter === "leasing" && getInstructionType(p) !== "Leasing") return false;
    if (typeFilter === "lease_advisory" && getInstructionType(p) !== "Lease Advisory") return false;
    if (typeFilter === "sale" && getInstructionType(p) !== "Sale") return false;

    if (columnFilters.status?.length && !columnFilters.status.includes(p.status || "")) return false;
    if (columnFilters.assetClass?.length && !columnFilters.assetClass.includes(p.assetClass || "")) return false;
    if (columnFilters.tenure?.length && !columnFilters.tenure.includes(p.tenure || "")) return false;
    if (columnFilters.team?.length) {
      const engagements = Array.isArray(p.bgpEngagement) ? p.bgpEngagement : p.bgpEngagement ? [p.bgpEngagement] : [];
      if (!columnFilters.team.some(t => engagements.includes(t))) return false;
    }

    if (search) {
      const s = search.toLowerCase();
      const agentIds = agentLinks.filter(l => l.propertyId === p.id).map(l => l.userId);
      const agentNames = allUsers.filter(u => agentIds.includes(String(u.id))).map(u => (u.name || "").toLowerCase());
      if (
        !p.name.toLowerCase().includes(s) &&
        !agentNames.some(n => n.includes(s)) &&
        !(p.status || "").toLowerCase().includes(s) &&
        !(p.assetClass || "").toLowerCase().includes(s)
      ) return false;
    }

    return true;
  });

  return (
    <div className="p-4 sm:p-6 space-y-6" data-testid="instructions-page">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Handshake className="w-6 h-6" />
            Instructions
          </h1>
          <p className="text-sm text-muted-foreground">
            {effectiveTeam ? `${effectiveTeam} instructions` : "All team instructions"}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 overflow-x-auto pb-1">
        <Card
          className={`min-w-[140px] cursor-pointer transition-colors hover:border-primary/50 ${
            typeFilter === "all" ? "border-primary bg-primary/5" : ""
          }`}
          onClick={() => setTypeFilter("all")}
          data-testid="card-type-all"
        >
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <Handshake className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="text-lg font-bold">{instructionProperties.length}</p>
                <p className="text-xs text-muted-foreground">All Instructions</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card
          className={`min-w-[140px] cursor-pointer transition-colors hover:border-primary/50 ${
            typeFilter === "leasing" ? "border-primary bg-primary/5" : ""
          }`}
          onClick={() => setTypeFilter(typeFilter === "leasing" ? "all" : "leasing")}
          data-testid="card-type-leasing"
        >
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-blue-500" />
              <div>
                <p className="text-lg font-bold">{leasingCount}</p>
                <p className="text-xs text-muted-foreground">Leasing</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card
          className={`min-w-[140px] cursor-pointer transition-colors hover:border-primary/50 ${
            typeFilter === "lease_advisory" ? "border-primary bg-primary/5" : ""
          }`}
          onClick={() => setTypeFilter(typeFilter === "lease_advisory" ? "all" : "lease_advisory")}
          data-testid="card-type-lease-advisory"
        >
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-violet-500" />
              <div>
                <p className="text-lg font-bold">{leaseAdvisoryCount}</p>
                <p className="text-xs text-muted-foreground">Lease Advisory</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card
          className={`min-w-[140px] cursor-pointer transition-colors hover:border-primary/50 ${
            typeFilter === "sale" ? "border-primary bg-primary/5" : ""
          }`}
          onClick={() => setTypeFilter(typeFilter === "sale" ? "all" : "sale")}
          data-testid="card-type-sale"
        >
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-emerald-500" />
              <div>
                <p className="text-lg font-bold">{saleCount}</p>
                <p className="text-xs text-muted-foreground">Sales</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search instructions..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-search-instructions"
          />
        </div>
        {(search || typeFilter !== "all" || hasColumnFilters) && (
          <Button
            variant="outline"
            size="sm"
            onClick={clearAllFilters}
            data-testid="button-clear-all-filters"
          >
            <X className="w-3.5 h-3.5 mr-1.5" />
            Clear all
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : (
            <ScrollableTable minWidth={1800}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"></TableHead>
                    <TableHead className="min-w-[200px]">Property</TableHead>
                    <TableHead className="min-w-[160px]">Landlord</TableHead>
                    <TableHead className="min-w-[120px]">
                      <ColumnFilterPopover
                        label="Status"
                        options={STATUS_OPTIONS}
                        activeFilters={columnFilters.status || []}
                        onToggleFilter={(val) => toggleColumnFilter("status", val)}
                      />
                    </TableHead>
                    <TableHead className="min-w-[120px]">
                      <ColumnFilterPopover
                        label="Asset Class"
                        options={ASSET_CLASS_OPTIONS}
                        activeFilters={columnFilters.assetClass || []}
                        onToggleFilter={(val) => toggleColumnFilter("assetClass", val)}
                      />
                    </TableHead>
                    <TableHead className="min-w-[120px]">
                      <ColumnFilterPopover
                        label="Tenure"
                        options={TENURE_OPTIONS}
                        activeFilters={columnFilters.tenure || []}
                        onToggleFilter={(val) => toggleColumnFilter("tenure", val)}
                      />
                    </TableHead>
                    <TableHead className="min-w-[120px]">
                      <ColumnFilterPopover
                        label="Team"
                        options={TEAM_OPTIONS}
                        activeFilters={columnFilters.team || []}
                        onToggleFilter={(val) => toggleColumnFilter("team", val)}
                      />
                    </TableHead>
                    <TableHead className="min-w-[160px]">WIP</TableHead>
                    <TableHead className="min-w-[160px]">Tenants</TableHead>
                    <TableHead className="min-w-[140px]">Agents</TableHead>
                    <TableHead className="min-w-[80px]">Sq Ft</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProperties.map((property) => {
                    const instrType = getInstructionType(property);
                    return (
                      <TableRow
                        key={property.id}
                        className="hover:bg-muted/50"
                        data-testid={`instruction-row-${property.id}`}
                      >
                        <TableCell className="w-10 pr-0">
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleFavoriteMutation.mutate(property.id); }}
                            className="p-1 hover:bg-muted rounded transition-colors"
                            data-testid={`star-instruction-${property.id}`}
                          >
                            <Star className={`w-4 h-4 ${favoriteIds.includes(property.id) ? "text-amber-500 fill-amber-500" : "text-muted-foreground/40 hover:text-amber-400"}`} />
                          </button>
                        </TableCell>
                        <TableCell className="font-medium text-sm">
                          <div className="flex items-center gap-2">
                            <Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <div className="min-w-0">
                              <Link href={`/properties/${property.id}`}>
                                <span className="hover:underline block cursor-pointer">{property.name}</span>
                              </Link>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <InlineLandlord
                            propertyId={property.id}
                            landlordId={property.landlordId}
                            allCompanies={allCompanies}
                          />
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <InlineLabelSelect
                            value={property.status}
                            options={STATUS_OPTIONS}
                            colorMap={PROPERTY_STATUS_COLORS}
                            onSave={(val) => handleInlineSave(property.id, "status", val)}
                            placeholder="Set status"
                          />
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <InlineLabelSelect
                            value={property.assetClass}
                            options={ASSET_CLASS_OPTIONS}
                            colorMap={ASSET_CLASS_COLORS}
                            onSave={(val) => handleInlineSave(property.id, "assetClass", val)}
                            placeholder="Set class"
                          />
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <InlineLabelSelect
                            value={property.tenure}
                            options={TENURE_OPTIONS}
                            colorMap={TENURE_COLORS}
                            onSave={(val) => handleInlineSave(property.id, "tenure", val)}
                            placeholder="Set tenure"
                          />
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <InlineEngagement
                            value={property.bgpEngagement}
                            options={TEAM_OPTIONS}
                            colorMap={TEAM_COLORS}
                            onSave={(val) => handleInlineSave(property.id, "bgpEngagement", val)}
                          />
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <InlineDeals
                            propertyId={property.id}
                            dealLinks={dealLinks}
                            allDeals={allDealsRaw}
                          />
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <InlineTenants
                            propertyId={property.id}
                            tenantLinks={tenantLinks}
                            allCompanies={allCompanies}
                          />
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <InlineAgents
                            propertyId={property.id}
                            agentLinks={agentLinks}
                            allUsers={allUsers}
                          />
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <InlineNumber
                            value={property.sqft ? Number(property.sqft) : null}
                            onSave={(v) => handleInlineSave(property.id, "sqft", v)}
                            suffix=" sqft"
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {filteredProperties.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                        <Handshake className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        <p className="text-sm">No instructions found</p>
                        <p className="text-xs mt-1">No properties with Instruction status</p>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </ScrollableTable>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
