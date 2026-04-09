import { useQuery, useMutation } from "@tanstack/react-query";
import { ScrollableTable } from "@/components/scrollable-table";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Search, Plus, Pencil, Trash2, Link2, Eye, FileText, Send, CalendarDays, HandCoins, Users, Mail, Phone, ChevronDown, ChevronUp, Filter, X, Paperclip, Download, Upload, Loader2, Check, ArrowRightLeft, Unlink, ExternalLink,
} from "lucide-react";
import { Link } from "wouter";
import { CardContent } from "@/components/ui/card";
import { useState, useMemo, useRef, Fragment } from "react";
import { Button } from "@/components/ui/button";

import { apiRequest, queryClient, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { InlineText, InlineNumber, InlineSelect, InlineDate, InlineLabelSelect } from "@/components/inline-edit";
import { buildUserIdColorMap } from "@/lib/agent-colors";
import type { InvestmentTracker, CrmProperty, CrmDeal, CrmCompany, CrmContact, InvestmentViewing, InvestmentOffer, InvestmentDistribution } from "@shared/schema";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";

const STATUSES = ["Reporting", "Speculative", "Live", "Available", "Under Offer", "Completed"];
const SUMMARY_STATUSES = ["Reporting", "Speculative", "Live", "Available", "Under Offer", "Completed"];
const BOARD_TYPES = ["Purchases", "Sales"] as const;
type BoardType = typeof BOARD_TYPES[number];
const ASSET_CLASSES = ["Retail", "Office", "Industrial", "Mixed Use", "F&B", "Leisure", "Residential"];
const TENURES = ["Freehold", "Leasehold", "Virtual Freehold"];
const FEE_TYPES = ["% of Price", "Fixed Fee", "Retainer + Success", "Other"];

const STATUS_COLORS: Record<string, string> = {
  "Reporting": "bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-300",
  "Speculative": "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  "Live": "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  "Available": "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  "Under Offer": "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  "Completed": "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
};

const ASSET_CLASS_COLORS: Record<string, string> = {
  "Retail": "bg-pink-500",
  "Office": "bg-sky-500",
  "Industrial": "bg-orange-500",
  "Mixed Use": "bg-purple-500",
  "F&B": "bg-red-500",
  "Leisure": "bg-teal-500",
  "Residential": "bg-emerald-500",
};

const STATUS_LABEL_COLORS: Record<string, string> = {
  "Reporting": "bg-slate-500",
  "Speculative": "bg-violet-500",
  "Live": "bg-blue-500",
  "Available": "bg-amber-500",
  "Under Offer": "bg-orange-500",
  "Completed": "bg-green-500",
};

function fmtNum(n: number | null | undefined) {
  if (n == null) return "—";
  return n.toLocaleString("en-GB");
}

function fmtCurrency(n: number | null | undefined) {
  if (n == null) return "—";
  return `£${n.toLocaleString("en-GB")}`;
}

function fmtPct(n: number | null | undefined) {
  if (n == null) return "—";
  return `${n.toFixed(2)}%`;
}

function CrmPicker({ items, value, valueName, onSelect, placeholder, testId }: {
  items: { id: string; name: string }[];
  value: string;
  valueName: string;
  onSelect: (id: string, name: string) => void;
  placeholder: string;
  testId: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    if (!search) return items.slice(0, 50);
    const q = search.toLowerCase();
    return items.filter(i => i.name.toLowerCase().includes(q)).slice(0, 50);
  }, [items, search]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="w-full text-left text-xs truncate cursor-pointer hover:bg-muted/60 rounded px-1.5 py-0.5 transition-colors"
          data-testid={testId}
        >
          {valueName || <span className="text-muted-foreground italic">{placeholder}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[280px]" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder={`Search ${placeholder.toLowerCase()}...`} value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>No results</CommandEmpty>
            <CommandGroup>
              {value && (
                <CommandItem onSelect={() => { onSelect("", ""); setOpen(false); setSearch(""); }} className="text-muted-foreground text-xs">
                  Clear selection
                </CommandItem>
              )}
              {filtered.map(i => (
                <CommandItem key={i.id} onSelect={() => { onSelect(i.id, i.name); setOpen(false); setSearch(""); }}>
                  {i.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

interface FormState {
  assetName: string;
  address: string;
  propertyId: string;
  assetType: string;
  tenure: string;
  guidePrice: string;
  niy: string;
  eqy: string;
  sqft: string;
  waultBreak: string;
  waultExpiry: string;
  currentRent: string;
  ervPa: string;
  occupancy: string;
  capexRequired: string;
  boardType: string;
  status: string;
  client: string;
  clientId: string;
  clientContact: string;
  clientContactId: string;
  vendor: string;
  vendorId: string;
  vendorAgent: string;
  vendorAgentId: string;
  buyer: string;
  notes: string;
  fee: string;
  feeType: string;
  marketingDate: string;
  bidDeadline: string;
  agentUserIds: string[];
}

function makeEmptyForm(boardType: BoardType): FormState {
  return {
    assetName: "",
    address: "",
    propertyId: "",
    assetType: "",
    tenure: "",
    guidePrice: "",
    niy: "",
    eqy: "",
    sqft: "",
    waultBreak: "",
    waultExpiry: "",
    currentRent: "",
    ervPa: "",
    occupancy: "",
    capexRequired: "",
    boardType,
    status: "Reporting",
    client: "",
    clientId: "",
    clientContact: "",
    clientContactId: "",
    vendor: "",
    vendorId: "",
    vendorAgent: "",
    vendorAgentId: "",
    buyer: "",
    notes: "",
    fee: "",
    feeType: "",
    marketingDate: "",
    bidDeadline: "",
    agentUserIds: [],
  };
}

function formToPayload(f: FormState) {
  return {
    assetName: f.assetName,
    address: f.address || null,
    propertyId: f.propertyId,
    assetType: f.assetType || null,
    tenure: f.tenure || null,
    guidePrice: f.guidePrice ? parseFloat(f.guidePrice) : null,
    niy: f.niy ? parseFloat(f.niy) : null,
    eqy: f.eqy ? parseFloat(f.eqy) : null,
    sqft: f.sqft ? parseFloat(f.sqft) : null,
    waultBreak: f.waultBreak ? parseFloat(f.waultBreak) : null,
    waultExpiry: f.waultExpiry ? parseFloat(f.waultExpiry) : null,
    currentRent: f.currentRent ? parseFloat(f.currentRent) : null,
    ervPa: f.ervPa ? parseFloat(f.ervPa) : null,
    occupancy: f.occupancy ? parseFloat(f.occupancy) : null,
    capexRequired: f.capexRequired ? parseFloat(f.capexRequired) : null,
    boardType: f.boardType || "Purchases",
    status: f.status || "Reporting",
    client: f.client || null,
    clientId: f.clientId || null,
    clientContact: f.clientContact || null,
    clientContactId: f.clientContactId || null,
    vendor: f.vendor || null,
    vendorId: f.vendorId || null,
    vendorAgent: f.vendorAgent || null,
    vendorAgentId: f.vendorAgentId || null,
    buyer: f.buyer || null,
    notes: f.notes || null,
    fee: f.fee ? parseFloat(f.fee) : null,
    feeType: f.feeType || null,
    marketingDate: f.marketingDate || null,
    bidDeadline: f.bidDeadline || null,
    agentUserIds: f.agentUserIds.length > 0 ? f.agentUserIds : null,
  };
}

function itemToForm(u: InvestmentTracker): FormState {
  return {
    assetName: u.assetName || "",
    address: u.address || "",
    propertyId: u.propertyId || "",
    assetType: u.assetType || "",
    tenure: u.tenure || "",
    guidePrice: u.guidePrice?.toString() || "",
    niy: u.niy?.toString() || "",
    eqy: u.eqy?.toString() || "",
    sqft: u.sqft?.toString() || "",
    waultBreak: u.waultBreak?.toString() || "",
    waultExpiry: u.waultExpiry?.toString() || "",
    currentRent: u.currentRent?.toString() || "",
    ervPa: u.ervPa?.toString() || "",
    occupancy: u.occupancy?.toString() || "",
    capexRequired: u.capexRequired?.toString() || "",
    boardType: u.boardType || "Purchases",
    status: u.status || "Reporting",
    client: u.client || "",
    clientId: u.clientId || "",
    clientContact: u.clientContact || "",
    clientContactId: u.clientContactId || "",
    vendor: u.vendor || "",
    vendorId: u.vendorId || "",
    vendorAgent: u.vendorAgent || "",
    vendorAgentId: u.vendorAgentId || "",
    buyer: u.buyer || "",
    notes: u.notes || "",
    fee: u.fee?.toString() || "",
    feeType: u.feeType || "",
    marketingDate: u.marketingDate || "",
    bidDeadline: u.bidDeadline || "",
    agentUserIds: Array.isArray(u.agentUserIds) ? u.agentUserIds : [],
  };
}

const OFFER_STATUSES = ["Pending", "Accepted", "Rejected", "Withdrawn", "Counter"];
const DISTRIBUTION_METHODS = ["Email", "WhatsApp", "Phone", "In Person", "Post"];
const DISTRIBUTION_RESPONSES = ["No Response", "Interested", "Not Interested", "Viewing Booked", "Offer Made", "Passed"];

function ViewingsDialog({ trackerId, assetName, open, onClose }: { trackerId: string; assetName: string; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ company: "", contact: "", viewingDate: "", attendees: "", outcome: "", notes: "" });

  const { data: viewings = [] } = useQuery<InvestmentViewing[]>({
    queryKey: ["/api/investment-tracker", trackerId, "viewings"],
    queryFn: () => fetch(`/api/investment-tracker/${trackerId}/viewings`, { credentials: "include", headers: getAuthHeaders() }).then(r => r.json()),
    enabled: open,
  });

  const addMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", `/api/investment-tracker/${trackerId}/viewings`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/investment-tracker", trackerId, "viewings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/investment-tracker/counts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/investment-tracker/all-viewings"] });
      setAdding(false);
      setForm({ company: "", contact: "", viewingDate: "", attendees: "", outcome: "", notes: "" });
      toast({ title: "Viewing added" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/investment-viewings/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/investment-tracker", trackerId, "viewings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/investment-tracker/counts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/investment-tracker/all-viewings"] });
      toast({ title: "Viewing deleted" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Viewings — {assetName}</DialogTitle>
          <DialogDescription>{viewings.length} viewing{viewings.length !== 1 ? "s" : ""} recorded</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {viewings.map(v => (
            <Card key={v.id} className="p-3 text-xs space-y-1">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-medium">{v.company || "Unknown company"}{v.contact ? ` — ${v.contact}` : ""}</p>
                  {v.viewingDate && <p className="text-muted-foreground">{new Date(v.viewingDate).toLocaleDateString("en-GB")}</p>}
                </div>
                <Button variant="ghost" size="icon" className="h-6 w-6 text-red-500" onClick={() => deleteMutation.mutate(v.id)}>
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
              {v.attendees && <p><span className="text-muted-foreground">Attendees:</span> {v.attendees}</p>}
              {v.outcome && <p><span className="text-muted-foreground">Outcome:</span> {v.outcome}</p>}
              {v.notes && <p className="text-muted-foreground">{v.notes}</p>}
            </Card>
          ))}
          {adding ? (
            <Card className="p-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-xs">Company</Label><Input value={form.company} onChange={e => setForm({ ...form, company: e.target.value })} className="h-8 text-xs" /></div>
                <div><Label className="text-xs">Contact</Label><Input value={form.contact} onChange={e => setForm({ ...form, contact: e.target.value })} className="h-8 text-xs" /></div>
                <div><Label className="text-xs">Date</Label><Input type="datetime-local" value={form.viewingDate} onChange={e => setForm({ ...form, viewingDate: e.target.value })} className="h-8 text-xs" /></div>
                <div><Label className="text-xs">Attendees</Label><Input value={form.attendees} onChange={e => setForm({ ...form, attendees: e.target.value })} className="h-8 text-xs" /></div>
                <div><Label className="text-xs">Outcome</Label><Input value={form.outcome} onChange={e => setForm({ ...form, outcome: e.target.value })} className="h-8 text-xs" /></div>
              </div>
              <div><Label className="text-xs">Notes</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className="text-xs" /></div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={() => setAdding(false)}>Cancel</Button>
                <Button size="sm" onClick={() => addMutation.mutate({ ...form, viewingDate: form.viewingDate ? new Date(form.viewingDate).toISOString() : null })}>Add</Button>
              </div>
            </Card>
          ) : (
            <Button variant="outline" size="sm" className="w-full" onClick={() => setAdding(true)} data-testid="button-add-viewing">
              <Plus className="w-3 h-3 mr-1" /> Add Viewing
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function OffersDialog({ trackerId, assetName, open, onClose }: { trackerId: string; assetName: string; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ company: "", contact: "", offerDate: "", offerPrice: "", niy: "", conditions: "", status: "Pending", notes: "" });

  const { data: offers = [] } = useQuery<InvestmentOffer[]>({
    queryKey: ["/api/investment-tracker", trackerId, "offers"],
    queryFn: () => fetch(`/api/investment-tracker/${trackerId}/offers`, { credentials: "include", headers: getAuthHeaders() }).then(r => r.json()),
    enabled: open,
  });

  const addMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", `/api/investment-tracker/${trackerId}/offers`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/investment-tracker", trackerId, "offers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/investment-tracker/counts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/investment-tracker/all-offers"] });
      setAdding(false);
      setForm({ company: "", contact: "", offerDate: "", offerPrice: "", niy: "", conditions: "", status: "Pending", notes: "" });
      toast({ title: "Offer added" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/investment-offers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/investment-tracker", trackerId, "offers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/investment-tracker/counts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/investment-tracker/all-offers"] });
      toast({ title: "Offer deleted" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Offers — {assetName}</DialogTitle>
          <DialogDescription>{offers.length} offer{offers.length !== 1 ? "s" : ""} recorded</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {offers.map(o => (
            <Card key={o.id} className="p-3 text-xs space-y-1">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-medium">{o.company || "Unknown"}{o.contact ? ` — ${o.contact}` : ""}</p>
                  <div className="flex gap-2 items-center">
                    {o.offerPrice != null && <span className="font-semibold">£{o.offerPrice.toLocaleString("en-GB")}</span>}
                    {o.niy != null && <span className="text-muted-foreground">{o.niy.toFixed(2)}% NIY</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Badge variant={o.status === "Accepted" ? "default" : "outline"} className="text-[10px]">{o.status}</Badge>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-red-500" onClick={() => deleteMutation.mutate(o.id)}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
              {o.offerDate && <p className="text-muted-foreground">{new Date(o.offerDate).toLocaleDateString("en-GB")}</p>}
              {o.conditions && <p><span className="text-muted-foreground">Conditions:</span> {o.conditions}</p>}
              {o.notes && <p className="text-muted-foreground">{o.notes}</p>}
            </Card>
          ))}
          {adding ? (
            <Card className="p-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-xs">Company</Label><Input value={form.company} onChange={e => setForm({ ...form, company: e.target.value })} className="h-8 text-xs" /></div>
                <div><Label className="text-xs">Contact</Label><Input value={form.contact} onChange={e => setForm({ ...form, contact: e.target.value })} className="h-8 text-xs" /></div>
                <div><Label className="text-xs">Date</Label><Input type="date" value={form.offerDate} onChange={e => setForm({ ...form, offerDate: e.target.value })} className="h-8 text-xs" /></div>
                <div><Label className="text-xs">Offer Price (£)</Label><Input type="number" value={form.offerPrice} onChange={e => setForm({ ...form, offerPrice: e.target.value })} className="h-8 text-xs" /></div>
                <div><Label className="text-xs">NIY (%)</Label><Input type="number" step="0.01" value={form.niy} onChange={e => setForm({ ...form, niy: e.target.value })} className="h-8 text-xs" /></div>
                <div>
                  <Label className="text-xs">Status</Label>
                  <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>{OFFER_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div><Label className="text-xs">Conditions</Label><Input value={form.conditions} onChange={e => setForm({ ...form, conditions: e.target.value })} className="h-8 text-xs" /></div>
              <div><Label className="text-xs">Notes</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className="text-xs" /></div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={() => setAdding(false)}>Cancel</Button>
                <Button size="sm" onClick={() => addMutation.mutate({
                  ...form,
                  offerPrice: form.offerPrice ? parseFloat(form.offerPrice) : null,
                  niy: form.niy ? parseFloat(form.niy) : null,
                  offerDate: form.offerDate ? new Date(form.offerDate).toISOString() : null,
                })}>Add</Button>
              </div>
            </Card>
          ) : (
            <Button variant="outline" size="sm" className="w-full" onClick={() => setAdding(true)} data-testid="button-add-offer">
              <Plus className="w-3 h-3 mr-1" /> Add Offer
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DistributionsDialog({ trackerId, assetName, open, onClose }: { trackerId: string; assetName: string; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ contactName: "", companyName: "", sentDate: "", method: "Email", documentType: "", response: "", notes: "" });

  const { data: distributions = [] } = useQuery<InvestmentDistribution[]>({
    queryKey: ["/api/investment-tracker", trackerId, "distributions"],
    queryFn: () => fetch(`/api/investment-tracker/${trackerId}/distributions`, { credentials: "include", headers: getAuthHeaders() }).then(r => r.json()),
    enabled: open,
  });

  const addMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", `/api/investment-tracker/${trackerId}/distributions`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/investment-tracker", trackerId, "distributions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/investment-tracker/counts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/investment-tracker/all-distributions"] });
      setAdding(false);
      setForm({ contactName: "", companyName: "", sentDate: "", method: "Email", documentType: "", response: "", notes: "" });
      toast({ title: "Distribution recorded" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => apiRequest("PATCH", `/api/investment-distributions/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/investment-tracker", trackerId, "distributions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/investment-tracker/all-distributions"] });
      toast({ title: "Updated" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/investment-distributions/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/investment-tracker", trackerId, "distributions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/investment-tracker/counts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/investment-tracker/all-distributions"] });
      toast({ title: "Removed" });
    },
  });

  const responseSummary = useMemo(() => {
    const s: Record<string, number> = {};
    for (const d of distributions) {
      const r = d.response || "No Response";
      s[r] = (s[r] || 0) + 1;
    }
    return s;
  }, [distributions]);

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Sent To — {assetName}</DialogTitle>
          <DialogDescription>Track who has received details about this opportunity</DialogDescription>
        </DialogHeader>
        {distributions.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            {Object.entries(responseSummary).map(([r, c]) => (
              <Badge key={r} variant="outline" className="text-[10px]">{r}: {c}</Badge>
            ))}
          </div>
        )}
        <div className="space-y-2">
          {distributions.map(d => (
            <Card key={d.id} className="p-3 text-xs">
              <div className="flex justify-between items-start gap-2">
                <div className="flex-1 space-y-0.5">
                  <p className="font-medium">{d.contactName || "Unknown"}{d.companyName ? ` (${d.companyName})` : ""}</p>
                  <div className="flex gap-2 text-muted-foreground">
                    <span>{d.method || "Email"}</span>
                    {d.sentDate && <span>{new Date(d.sentDate).toLocaleDateString("en-GB")}</span>}
                    {d.documentType && <span>• {d.documentType}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Select value={d.response || "No Response"} onValueChange={v => updateMutation.mutate({ id: d.id, data: { response: v, responseDate: new Date().toISOString() } })}>
                    <SelectTrigger className="h-7 text-[10px] w-[120px]"><SelectValue /></SelectTrigger>
                    <SelectContent>{DISTRIBUTION_RESPONSES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                  </Select>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-red-500" onClick={() => deleteMutation.mutate(d.id)}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
              {d.notes && <p className="text-muted-foreground mt-1">{d.notes}</p>}
            </Card>
          ))}
          {adding ? (
            <Card className="p-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-xs">Contact Name</Label><Input value={form.contactName} onChange={e => setForm({ ...form, contactName: e.target.value })} className="h-8 text-xs" /></div>
                <div><Label className="text-xs">Company</Label><Input value={form.companyName} onChange={e => setForm({ ...form, companyName: e.target.value })} className="h-8 text-xs" /></div>
                <div><Label className="text-xs">Sent Date</Label><Input type="date" value={form.sentDate} onChange={e => setForm({ ...form, sentDate: e.target.value })} className="h-8 text-xs" /></div>
                <div>
                  <Label className="text-xs">Method</Label>
                  <Select value={form.method} onValueChange={v => setForm({ ...form, method: v })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>{DISTRIBUTION_METHODS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label className="text-xs">Document Type</Label><Input value={form.documentType} onChange={e => setForm({ ...form, documentType: e.target.value })} className="h-8 text-xs" placeholder="e.g. Why Buy PDF" /></div>
              </div>
              <div><Label className="text-xs">Notes</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className="text-xs" /></div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={() => setAdding(false)}>Cancel</Button>
                <Button size="sm" onClick={() => addMutation.mutate({
                  ...form,
                  sentDate: form.sentDate ? new Date(form.sentDate).toISOString() : new Date().toISOString(),
                })}>Add</Button>
              </div>
            </Card>
          ) : (
            <Button variant="outline" size="sm" className="w-full" onClick={() => setAdding(true)} data-testid="button-add-distribution">
              <Plus className="w-3 h-3 mr-1" /> Add Recipient
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MarketingFilesDialog({ trackerId, assetName, open, onClose }: { trackerId: string; assetName: string; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const { data: files = [], isLoading } = useQuery<{ id: string; fileName: string; fileSize: number | null; mimeType: string | null; createdAt: string }[]>({
    queryKey: ["/api/investment-tracker", trackerId, "marketing-files"],
    enabled: open,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/investment-marketing-files/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/investment-tracker", trackerId, "marketing-files"] });
      queryClient.invalidateQueries({ queryKey: ["/api/investment-tracker/all-marketing-files"] });
      toast({ title: "File deleted" });
    },
  });

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/investment-tracker/${trackerId}/marketing-files`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      queryClient.invalidateQueries({ queryKey: ["/api/investment-tracker", trackerId, "marketing-files"] });
      queryClient.invalidateQueries({ queryKey: ["/api/investment-tracker/all-marketing-files"] });
      toast({ title: "File uploaded" });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function formatSize(bytes: number | null) {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Marketing Files</DialogTitle>
          <DialogDescription>{assetName}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {isLoading ? (
            <div className="text-xs text-muted-foreground">Loading...</div>
          ) : files.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-4">No files uploaded yet</div>
          ) : (
            <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
              {files.map((f) => (
                <div key={f.id} className="flex items-center justify-between gap-2 p-2 rounded border bg-muted/30 text-xs">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <Paperclip className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate font-medium">{f.fileName}</span>
                    <span className="text-muted-foreground shrink-0">{formatSize(f.fileSize)}</span>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-6 w-6" asChild data-testid={`button-download-file-${f.id}`}>
                      <a href={`/api/investment-marketing-files/${f.id}/download`} download>
                        <Download className="w-3 h-3" />
                      </a>
                    </Button>
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-red-500" onClick={() => deleteMutation.mutate(f.id)} data-testid={`button-delete-file-${f.id}`}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.gif,.webp" />
          <Button variant="outline" size="sm" className="w-full" onClick={() => fileInputRef.current?.click()} disabled={uploading} data-testid="button-upload-marketing-file">
            {uploading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Upload className="w-3 h-3 mr-1" />}
            {uploading ? "Uploading..." : "Upload File"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InlineAgentMultiSelect({ value, users, onSave, testId, colorMap }: { value: string[]; users: { id: string; name: string }[]; onSave: (ids: string[]) => void; testId?: string; colorMap?: Record<string, string> }) {
  const [open, setOpen] = useState(false);

  function toggle(uid: string) {
    const next = value.includes(uid) ? value.filter(id => id !== uid) : [...value, uid];
    onSave(next);
  }

  const selectedUsers = value.map(uid => users.find(u => u.id === uid)).filter(Boolean) as { id: string; name: string }[];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="text-xs text-left w-full px-1 py-0.5 rounded hover:bg-muted/50 cursor-pointer truncate flex items-center gap-1 flex-wrap"
          data-testid={testId}
        >
          {selectedUsers.length > 0 ? selectedUsers.map(u => {
            const bg = colorMap?.[u.id] || "bg-zinc-500";
            return (
              <span key={u.id} className={`inline-flex items-center text-[10px] px-1.5 py-0 rounded text-white ${bg}`}>
                {u.name.split(" ")[0]}
              </span>
            );
          }) : <span className="text-muted-foreground">—</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-1" align="start">
        <div className="max-h-[200px] overflow-y-auto space-y-0.5">
          {users.map(u => {
            const selected = value.includes(u.id);
            const bg = colorMap?.[u.id] || "bg-zinc-500";
            return (
              <button
                key={u.id}
                className={`w-full text-left text-xs px-2 py-1.5 rounded flex items-center gap-2 hover:bg-muted/60 ${selected ? "bg-muted font-medium" : ""}`}
                onClick={() => toggle(u.id)}
                data-testid={`agent-option-${u.id}`}
              >
                <div className={`w-3.5 h-3.5 rounded-full flex items-center justify-center ${selected ? bg : "border border-muted-foreground/40"}`}>
                  {selected && <Check className="w-2.5 h-2.5 text-white" />}
                </div>
                {u.name}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function FilterHead({ label, value, options, onChange, className = "", colorMap }: {
  label: string;
  value: string;
  options: readonly string[] | string[];
  onChange: (v: string) => void;
  className?: string;
  colorMap?: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const active = value !== "all";
  return (
    <TableHead className={className}>
      <div className="relative">
        <button
          onClick={() => setOpen(!open)}
          className={`flex items-center gap-0.5 font-medium hover:text-foreground transition-colors ${active ? "text-primary" : ""}`}
          data-testid={`filter-${label.toLowerCase().replace(/[\s()%]/g, "-")}`}
        >
          {label}
          {active ? <Filter className="w-3 h-3 text-primary" /> : <ChevronDown className="w-3 h-3 opacity-50" />}
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div className="absolute z-50 top-full left-0 mt-1 w-[160px] bg-popover border rounded-lg shadow-lg p-1 max-h-[240px] overflow-y-auto">
              <button
                onClick={() => { onChange("all"); setOpen(false); }}
                className={`w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted transition-colors ${!active ? "font-semibold" : ""}`}
                data-testid="filter-option-all"
              >
                All
              </button>
              {options.map(opt => (
                <button
                  key={opt}
                  onClick={() => { onChange(opt); setOpen(false); }}
                  className={`w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted transition-colors flex items-center gap-1.5 ${value === opt ? "font-semibold" : ""}`}
                  data-testid={`filter-option-${opt.toLowerCase().replace(/\s/g, "-")}`}
                >
                  {colorMap?.[opt] && <span className={`w-2.5 h-2.5 rounded-full ${colorMap[opt]} shrink-0`} />}
                  {opt}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </TableHead>
  );
}

export default function InvestmentTrackerPage() {
  const [boardType, setBoardType] = useState<BoardType>("Purchases");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [assetClassFilter, setAssetClassFilter] = useState("all");
  const [tenureFilter, setTenureFilter] = useState("all");
  const [agentFilter, setAgentFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [editItem, setEditItem] = useState<InvestmentTracker | null>(null);
  const [deleteItem, setDeleteItem] = useState<InvestmentTracker | null>(null);
  const [linkDealOpen, setLinkDealOpen] = useState<InvestmentTracker | null>(null);
  const [linkDealId, setLinkDealId] = useState("");
  const [form, setForm] = useState<FormState>(makeEmptyForm("Purchases"));
  const [viewingsItem, setViewingsItem] = useState<InvestmentTracker | null>(null);
  const [offersItem, setOffersItem] = useState<InvestmentTracker | null>(null);
  const [distItem, setDistItem] = useState<InvestmentTracker | null>(null);
  const [chartsExpanded, setChartsExpanded] = useState(false);
  const [filesItem, setFilesItem] = useState<InvestmentTracker | null>(null);
  const { toast } = useToast();

  const { data: items = [], isLoading } = useQuery<InvestmentTracker[]>({
    queryKey: ["/api/investment-tracker"],
  });

  const { data: properties = [] } = useQuery<CrmProperty[]>({
    queryKey: ["/api/crm/properties"],
  });

  const { data: deals = [] } = useQuery<CrmDeal[]>({
    queryKey: ["/api/crm/deals"],
  });

  const { data: bgpUsers = [] } = useQuery<{ id: string; name: string; team?: string }[]>({
    queryKey: ["/api/users"],
  });
  const userIdColorMap = useMemo(() => buildUserIdColorMap(bgpUsers), [bgpUsers]);

  const { data: companies = [] } = useQuery<CrmCompany[]>({
    queryKey: ["/api/crm/companies"],
  });

  const { data: contacts = [] } = useQuery<CrmContact[]>({
    queryKey: ["/api/crm/contacts"],
  });

  const { data: counts } = useQuery<{ viewings: Record<string, number>; offers: Record<string, number>; distributions: Record<string, number> }>({
    queryKey: ["/api/investment-tracker/counts"],
    queryFn: async () => {
      const r = await fetch("/api/investment-tracker/counts/all", { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) throw new Error(`${r.status}`);
      return r.json();
    },
  });

  const { data: marketingFileCounts = {} } = useQuery<Record<string, number>>({
    queryKey: ["/api/investment-tracker/all-marketing-files"],
  });

  const { data: allViewings = [] } = useQuery<InvestmentViewing[]>({
    queryKey: ["/api/investment-tracker/all-viewings"],
  });

  const { data: allOffers = [] } = useQuery<InvestmentOffer[]>({
    queryKey: ["/api/investment-tracker/all-offers"],
  });

  const { data: allDistributions = [] } = useQuery<InvestmentDistribution[]>({
    queryKey: ["/api/investment-tracker/all-distributions"],
  });

  const propertyMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of properties) m.set(p.id, p.name);
    return m;
  }, [properties]);

  const dealMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of deals) m.set(d.id, d.name);
    return m;
  }, [deals]);

  const propertyItems = useMemo(() => properties.map(p => ({ id: p.id, name: p.name })), [properties]);
  const dealItems = useMemo(() => deals.map(d => ({ id: d.id, name: d.name })), [deals]);
  const companyItems = useMemo(() => companies.map(c => ({ id: c.id, name: c.name })), [companies]);
  const contactItems = useMemo(() => contacts.map(c => ({ id: c.id, name: c.companyName ? `${c.name} (${c.companyName})` : c.name })), [contacts]);
  const contactByName = useMemo(() => {
    const m = new Map<string, CrmContact>();
    for (const c of contacts) {
      m.set(c.name, c);
      if (c.companyName) m.set(`${c.name} (${c.companyName})`, c);
    }
    return m;
  }, [contacts]);
  const agentContacts = useMemo(() => contacts.filter(c => c.contactType === "Agent"), [contacts]);
  const agentContactItems = useMemo(() => agentContacts.map(c => ({ id: c.id, name: c.companyName ? `${c.name} (${c.companyName})` : c.name })), [agentContacts]);

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/investment-tracker", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/investment-tracker"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/properties"] });
      setCreateOpen(false);
      setForm(makeEmptyForm(boardType));
      toast({ title: "Asset added" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => apiRequest("PATCH", `/api/investment-tracker/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/investment-tracker"] });
      setEditItem(null);
      toast({ title: "Updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/investment-tracker/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/investment-tracker"] });
      setDeleteItem(null);
      toast({ title: "Deleted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const linkDealMutation = useMutation({
    mutationFn: ({ id, dealId }: { id: string; dealId: string }) => apiRequest("POST", `/api/investment-tracker/${id}/link-deal`, { dealId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/investment-tracker"] });
      setLinkDealOpen(null);
      setLinkDealId("");
      toast({ title: "Deal linked" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const unlinkDealMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/investment-tracker/${id}/unlink-deal`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/investment-tracker"] });
      toast({ title: "Deal unlinked" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const createDealMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/investment-tracker/${id}/create-deal`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/investment-tracker"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/deals"] });
      toast({ title: "WIP deal created and linked" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const inlineUpdate = (id: string, field: string, value: any) => {
    updateMutation.mutate({ id, data: { [field]: value } });
  };

  const boardItems = useMemo(() => items.filter(u => (u.boardType || "Purchases") === boardType), [items, boardType]);

  const filtered = useMemo(() => {
    let list = boardItems;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(u =>
        u.assetName.toLowerCase().includes(q) ||
        (u.address || "").toLowerCase().includes(q) ||
        (u.client || "").toLowerCase().includes(q) ||
        (u.vendor || "").toLowerCase().includes(q) ||
        (u.buyer || "").toLowerCase().includes(q) ||
        (u.vendorAgent || "").toLowerCase().includes(q)
      );
    }
    if (statusFilter !== "all") list = list.filter(u => u.status === statusFilter);
    if (assetClassFilter !== "all") list = list.filter(u => u.assetType === assetClassFilter);
    if (tenureFilter !== "all") list = list.filter(u => u.tenure === tenureFilter);
    if (agentFilter !== "all") {
      const agentUser = bgpUsers.find(u => u.name === agentFilter);
      if (agentUser) list = list.filter(u => (u.agentUserIds || []).includes(agentUser.id));
    }
    const statusOrder = Object.fromEntries(STATUSES.map((s, i) => [s, i]));
    list = [...list].sort((a, b) => (statusOrder[a.status || "Reporting"] ?? 99) - (statusOrder[b.status || "Reporting"] ?? 99));
    return list;
  }, [boardItems, search, statusFilter, assetClassFilter, tenureFilter, agentFilter, bgpUsers]);

  const statusSummary = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of STATUSES) c[s] = 0;
    for (const u of boardItems) c[u.status || "Reporting"] = (c[u.status || "Reporting"] || 0) + 1;
    return c;
  }, [boardItems]);

  const FY_MONTHS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];
  const FY_MONTH_NUMS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];

  const currentFYStart = useMemo(() => {
    const now = new Date();
    return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  }, []);

  const boardTrackerIds = useMemo(() => new Set(boardItems.map(i => i.id)), [boardItems]);

  const viewingsMonthly = useMemo(() => {
    const buckets: number[] = new Array(12).fill(0);
    for (const v of allViewings) {
      if (!v.viewingDate || !boardTrackerIds.has(v.trackerId)) continue;
      const d = new Date(v.viewingDate);
      const m = d.getMonth() + 1;
      const y = d.getFullYear();
      const fyIdx = FY_MONTH_NUMS.indexOf(m);
      if (fyIdx === -1) continue;
      const expectedYear = m >= 4 ? currentFYStart : currentFYStart + 1;
      if (y === expectedYear) buckets[fyIdx]++;
    }
    return buckets;
  }, [allViewings, currentFYStart, boardTrackerIds]);

  const offersMonthly = useMemo(() => {
    const buckets: number[] = new Array(12).fill(0);
    for (const o of allOffers) {
      if (!o.offerDate || !boardTrackerIds.has(o.trackerId)) continue;
      const d = new Date(o.offerDate);
      const m = d.getMonth() + 1;
      const y = d.getFullYear();
      const fyIdx = FY_MONTH_NUMS.indexOf(m);
      if (fyIdx === -1) continue;
      const expectedYear = m >= 4 ? currentFYStart : currentFYStart + 1;
      if (y === expectedYear) buckets[fyIdx]++;
    }
    return buckets;
  }, [allOffers, currentFYStart, boardTrackerIds]);

  const introductionsMonthly = useMemo(() => {
    const buckets: number[] = new Array(12).fill(0);
    for (const d of allDistributions) {
      if (!d.sentDate || !boardTrackerIds.has(d.trackerId)) continue;
      const dt = new Date(d.sentDate);
      const m = dt.getMonth() + 1;
      const y = dt.getFullYear();
      const fyIdx = FY_MONTH_NUMS.indexOf(m);
      if (fyIdx === -1) continue;
      const expectedYear = m >= 4 ? currentFYStart : currentFYStart + 1;
      if (y === expectedYear) buckets[fyIdx]++;
    }
    return buckets;
  }, [allDistributions, currentFYStart, boardTrackerIds]);

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 h-[calc(100vh-3rem)] flex flex-col" data-testid="investment-tracker-page">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 shrink-0">
        <div>
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Investment Tracker</h1>
            <div className="inline-flex rounded-lg border bg-muted p-0.5" data-testid="toggle-board-type">
              {BOARD_TYPES.map(bt => (
                <button
                  key={bt}
                  onClick={() => { setBoardType(bt); setStatusFilter("all"); }}
                  className={`inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    boardType === bt
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  data-testid={`toggle-board-${bt.toLowerCase()}`}
                >
                  {bt}
                </button>
              ))}
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            {filtered.length} asset{filtered.length !== 1 ? "s" : ""} — {boardType}
          </p>
        </div>
        <Button onClick={() => { setForm(makeEmptyForm(boardType)); setCreateOpen(true); }} data-testid="button-add-asset">
          <Plus className="h-4 w-4 mr-1" /> Add Asset
        </Button>
      </div>

      <ScrollArea className="w-full shrink-0">
        <div className="flex items-center gap-3 pb-1">
          {SUMMARY_STATUSES.map(s => (
            <Card
              key={s}
              className={`flex-shrink-0 min-w-[120px] cursor-pointer transition-colors ${statusFilter === s ? "border-primary" : ""}`}
              onClick={() => setStatusFilter(statusFilter === s ? "all" : s)}
              data-testid={`card-status-${s.toLowerCase().replace(/\s/g, "-")}`}
            >
              <CardContent className="p-3">
                <div className="flex items-center gap-2">
                  <div className={`w-2.5 h-2.5 rounded-full ${STATUS_LABEL_COLORS[s] || "bg-primary/60"}`} />
                  <div>
                    <p className="text-lg font-bold">{statusSummary[s] || 0}</p>
                    <p className="text-xs text-muted-foreground truncate max-w-[100px]">{s}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>

      <div className="flex items-center gap-3 flex-wrap shrink-0">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search assets..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-search-assets"
          />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {STATUSES.map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(statusFilter === s ? "all" : s)}
              className={`${STATUS_LABEL_COLORS[s]} text-white text-[11px] font-medium px-2.5 py-1 rounded-full transition-all whitespace-nowrap ${
                statusFilter === s ? "ring-2 ring-primary ring-offset-1 scale-105" : statusFilter !== "all" ? "opacity-40" : "hover:opacity-90"
              }`}
              data-testid={`filter-status-${s.toLowerCase().replace(/\s/g, "-")}`}
            >
              {s}
              {statusFilter === s && <X className="inline h-3 w-3 ml-1 -mr-0.5" />}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-muted-foreground mr-0.5">Class:</span>
          {ASSET_CLASSES.map(c => (
            <button
              key={c}
              onClick={() => setAssetClassFilter(assetClassFilter === c ? "all" : c)}
              className={`${ASSET_CLASS_COLORS[c] || "bg-gray-500"} text-white text-[10px] font-medium px-2 py-0.5 rounded-full transition-all whitespace-nowrap ${
                assetClassFilter === c ? "ring-2 ring-primary ring-offset-1 scale-105" : assetClassFilter !== "all" ? "opacity-40" : "hover:opacity-90"
              }`}
              data-testid={`filter-class-${c.toLowerCase().replace(/\s/g, "-")}`}
            >
              {c}
              {assetClassFilter === c && <X className="inline h-3 w-3 ml-0.5 -mr-0.5" />}
            </button>
          ))}
        </div>
        <Select value={tenureFilter} onValueChange={setTenureFilter}>
          <SelectTrigger className="w-[160px]" data-testid="select-tenure-filter">
            <SelectValue placeholder="All Tenures" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Tenures</SelectItem>
            {TENURES.map(t => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={agentFilter} onValueChange={setAgentFilter}>
          <SelectTrigger className="w-[180px]" data-testid="select-agent-filter">
            <SelectValue placeholder="All Agents" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Agents</SelectItem>
            {bgpUsers.map(u => (
              <SelectItem key={u.id} value={u.name}>{u.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(statusFilter !== "all" || assetClassFilter !== "all" || tenureFilter !== "all" || agentFilter !== "all") && (
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => { setStatusFilter("all"); setAssetClassFilter("all"); setTenureFilter("all"); setAgentFilter("all"); }} data-testid="clear-all-filters">
            <X className="h-3 w-3" /> Clear filters
          </Button>
        )}
      </div>

      {/* Monthly Activity Charts */}
      <div className="flex items-center justify-between shrink-0">
        <Button
          variant="ghost"
          size="sm"
          className="text-xs gap-1.5 h-7 text-muted-foreground hover:text-foreground"
          onClick={() => setChartsExpanded(!chartsExpanded)}
          data-testid="button-toggle-activity-charts"
        >
          {chartsExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          <span className="font-semibold">Activity Charts</span>
          <span className="text-muted-foreground font-normal">
            — {viewingsMonthly.reduce((a: number, b: number) => a + b, 0)} viewings, {offersMonthly.reduce((a: number, b: number) => a + b, 0)} offers, {introductionsMonthly.reduce((a: number, b: number) => a + b, 0)} introductions
          </span>
        </Button>
      </div>
      {chartsExpanded && (<div className="grid grid-cols-1 lg:grid-cols-3 gap-4 shrink-0">
        <Card data-testid="card-viewings-chart">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-blue-500" />
                <span className="text-sm font-semibold">Viewings</span>
              </div>
              <span className="text-xs text-muted-foreground">FY {currentFYStart}/{currentFYStart + 1}</span>
            </div>
            <div className="flex items-end gap-1 h-16">
              {viewingsMonthly.map((count, i) => {
                const max = Math.max(...viewingsMonthly, 1);
                const h = Math.max((count / max) * 100, 4);
                const now = new Date();
                const currentMonthIdx = FY_MONTH_NUMS.indexOf(now.getMonth() + 1);
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-0.5" title={`${FY_MONTHS[i]}: ${count} viewing${count !== 1 ? "s" : ""}`}>
                    <div
                      className={`w-full rounded-t transition-all ${i === currentMonthIdx ? "bg-blue-500" : count > 0 ? "bg-blue-300 dark:bg-blue-700" : "bg-muted"}`}
                      style={{ height: `${h}%` }}
                    />
                    <span className="text-[9px] text-muted-foreground leading-none">{FY_MONTHS[i]}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-between mt-2 pt-2 border-t">
              <span className="text-xs text-muted-foreground">Total this FY</span>
              <span className="text-sm font-bold" data-testid="text-viewings-total">{viewingsMonthly.reduce((a, b) => a + b, 0)}</span>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-offers-chart">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <HandCoins className="h-4 w-4 text-amber-500" />
                <span className="text-sm font-semibold">Offers</span>
              </div>
              <span className="text-xs text-muted-foreground">FY {currentFYStart}/{currentFYStart + 1}</span>
            </div>
            <div className="flex items-end gap-1 h-16">
              {offersMonthly.map((count, i) => {
                const max = Math.max(...offersMonthly, 1);
                const h = Math.max((count / max) * 100, 4);
                const now = new Date();
                const currentMonthIdx = FY_MONTH_NUMS.indexOf(now.getMonth() + 1);
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-0.5" title={`${FY_MONTHS[i]}: ${count} offer${count !== 1 ? "s" : ""}`}>
                    <div
                      className={`w-full rounded-t transition-all ${i === currentMonthIdx ? "bg-amber-500" : count > 0 ? "bg-amber-300 dark:bg-amber-700" : "bg-muted"}`}
                      style={{ height: `${h}%` }}
                    />
                    <span className="text-[9px] text-muted-foreground leading-none">{FY_MONTHS[i]}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-between mt-2 pt-2 border-t">
              <span className="text-xs text-muted-foreground">Total this FY</span>
              <span className="text-sm font-bold" data-testid="text-offers-total">{offersMonthly.reduce((a, b) => a + b, 0)}</span>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-introductions-chart">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-green-500" />
                <span className="text-sm font-semibold">Introductions</span>
              </div>
              <span className="text-xs text-muted-foreground">FY {currentFYStart}/{currentFYStart + 1}</span>
            </div>
            <div className="flex items-end gap-1 h-16">
              {introductionsMonthly.map((count, i) => {
                const max = Math.max(...introductionsMonthly, 1);
                const h = Math.max((count / max) * 100, 4);
                const now = new Date();
                const currentMonthIdx = FY_MONTH_NUMS.indexOf(now.getMonth() + 1);
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-0.5" title={`${FY_MONTHS[i]}: ${count} introduction${count !== 1 ? "s" : ""}`}>
                    <div
                      className={`w-full rounded-t transition-all ${i === currentMonthIdx ? "bg-green-500" : count > 0 ? "bg-green-300 dark:bg-green-700" : "bg-muted"}`}
                      style={{ height: `${h}%` }}
                    />
                    <span className="text-[9px] text-muted-foreground leading-none">{FY_MONTHS[i]}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-between mt-2 pt-2 border-t">
              <span className="text-xs text-muted-foreground">Total this FY</span>
              <span className="text-sm font-bold" data-testid="text-introductions-total">{introductionsMonthly.reduce((a, b) => a + b, 0)}</span>
            </div>
          </CardContent>
        </Card>
      </div>
      )}

      {/* Table */}
      
      <Card className="flex-1 min-h-0 overflow-hidden">
        <ScrollableTable minWidth={2100}>
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[180px]">Asset</TableHead>
                  <FilterHead label="Asset Class" value={assetClassFilter} options={ASSET_CLASSES} onChange={setAssetClassFilter} colorMap={ASSET_CLASS_COLORS} className="w-[90px]" />
                  <FilterHead label="Tenure" value={tenureFilter} options={TENURES} onChange={setTenureFilter} className="w-[70px]" />
                  <TableHead className="w-[90px] text-right">Guide Price</TableHead>
                  <TableHead className="w-[60px] text-right">NIY (%)</TableHead>
                  <TableHead className="w-[70px] text-right">Sq Ft</TableHead>
                  <TableHead className="w-[80px] text-right">Rent (pa)</TableHead>
                  <TableHead className="w-[150px]">Client / Contact</TableHead>
                  {boardType === "Purchases" ? (
                    <>
                      <TableHead className="w-[150px]">Vendor / Agent</TableHead>
                      <TableHead className="w-[80px]">Bid Deadline</TableHead>
                    </>
                  ) : (
                    <>
                      <TableHead className="w-[120px]">Buyer</TableHead>
                      <TableHead className="w-[80px]">Marketing Date</TableHead>
                    </>
                  )}
                  <TableHead className="w-[70px] text-right">Fee</TableHead>
                  <FilterHead label="Status" value={statusFilter} options={STATUSES} onChange={setStatusFilter} colorMap={STATUS_LABEL_COLORS} className="w-[90px]" />
                  <FilterHead label="Agent" value={agentFilter} options={bgpUsers.map(u => u.name)} onChange={setAgentFilter} className="w-[90px]" />
                  <TableHead className="w-[60px] text-center">Files</TableHead>
                  <TableHead className="w-[50px] text-center">Views</TableHead>
                  <TableHead className="w-[50px] text-center">Offers</TableHead>
                  <TableHead className="w-[50px] text-center">Sent</TableHead>
                  <TableHead className="w-[180px]">Notes</TableHead>
                  <TableHead className="w-[100px]">WIP Deal</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={boardType === "Purchases" ? 20 : 19} className="text-center py-8 text-muted-foreground text-sm">
                      {boardItems.length === 0 ? `No ${boardType.toLowerCase()} tracked yet. Click 'Add Asset' to start.` : "No assets match your filters."}
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map(item => (
                  <TableRow key={item.id} className="text-xs" data-testid={`row-asset-${item.id}`}>
                    <TableCell className="px-1.5 py-1 font-medium">
                      <div>
                        <InlineText
                          value={item.assetName}
                          onSave={v => inlineUpdate(item.id, "assetName", v)}
                          className="text-xs font-medium"
                        />
                        {item.address && (
                          <div className="text-[10px] text-muted-foreground truncate max-w-[170px]">{item.address}</div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="px-1.5 py-1">
                      <InlineLabelSelect
                        value={item.assetType || ""}
                        options={ASSET_CLASSES}
                        colorMap={ASSET_CLASS_COLORS}
                        onSave={v => inlineUpdate(item.id, "assetType", v || null)}
                      />
                    </TableCell>
                    <TableCell className="px-1.5 py-1">
                      <InlineSelect
                        value={item.tenure || ""}
                        options={TENURES}
                        onSave={v => inlineUpdate(item.id, "tenure", v || null)}
                        className="text-xs"
                      />
                    </TableCell>
                    <TableCell className="px-1.5 py-1 text-right font-medium">
                      <InlineNumber
                        value={item.guidePrice}
                        onSave={v => inlineUpdate(item.id, "guidePrice", v)}
                        prefix="£"
                        format={v => v.toLocaleString("en-GB")}
                        className="text-xs text-right"
                      />
                    </TableCell>
                    <TableCell className="px-1.5 py-1 text-right">
                      <InlineNumber
                        value={item.niy}
                        onSave={v => inlineUpdate(item.id, "niy", v)}
                        suffix="%"
                        format={v => v.toFixed(2)}
                        className="text-xs text-right"
                      />
                    </TableCell>
                    <TableCell className="px-1.5 py-1 text-right">
                      <InlineNumber
                        value={item.sqft}
                        onSave={v => inlineUpdate(item.id, "sqft", v)}
                        format={v => v.toLocaleString("en-GB")}
                        className="text-xs text-right"
                      />
                    </TableCell>
                    <TableCell className="px-1.5 py-1 text-right">
                      <InlineNumber
                        value={item.currentRent}
                        onSave={v => inlineUpdate(item.id, "currentRent", v)}
                        prefix="£"
                        format={v => v.toLocaleString("en-GB")}
                        className="text-xs text-right"
                      />
                    </TableCell>
                    <TableCell className="px-1.5 py-1">
                      <div className="space-y-0.5">
                        <CrmPicker
                          items={companyItems}
                          value={item.client || ""}
                          valueName={item.client || ""}
                          onSelect={(id, name) => {
                            inlineUpdate(item.id, "client", name || null);
                            inlineUpdate(item.id, "clientId", id || null);
                          }}
                          placeholder="—"
                          testId={`picker-client-${item.id}`}
                        />
                        <div className="flex items-center gap-1.5 pl-1.5">
                          <CrmPicker
                            items={contactItems}
                            value={item.clientContact || ""}
                            valueName={item.clientContact || ""}
                            onSelect={(id, name) => {
                              inlineUpdate(item.id, "clientContact", name || null);
                              inlineUpdate(item.id, "clientContactId", id || null);
                            }}
                            placeholder="contact"
                            testId={`picker-client-contact-${item.id}`}
                          />
                          {item.clientContact && (() => {
                            const ct = contactByName.get(item.clientContact);
                            return (
                              <>
                                {ct?.email && (
                                  <a href={`mailto:${ct.email}`} className="text-muted-foreground hover:text-blue-500" title={ct.email} data-testid={`link-client-contact-email-${item.id}`}>
                                    <Mail className="h-3 w-3" />
                                  </a>
                                )}
                                {ct?.phone && (
                                  <a href={`tel:${ct.phone}`} className="text-muted-foreground hover:text-blue-500" title={ct.phone} data-testid={`link-client-contact-phone-${item.id}`}>
                                    <Phone className="h-3 w-3" />
                                  </a>
                                )}
                                {item.clientContactId && (
                                  <Link href={`/contacts/${item.clientContactId}`} className="text-muted-foreground hover:text-blue-500" title="View profile" data-testid={`link-client-contact-profile-${item.id}`}>
                                    <ExternalLink className="h-3 w-3" />
                                  </Link>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      </div>
                    </TableCell>
                    {boardType === "Purchases" ? (
                      <>
                        <TableCell className="px-1.5 py-1">
                          <div className="space-y-0.5">
                            <CrmPicker
                              items={companyItems}
                              value={item.vendor || ""}
                              valueName={item.vendor || ""}
                              onSelect={(id, name) => {
                                inlineUpdate(item.id, "vendor", name || null);
                                inlineUpdate(item.id, "vendorId", id || null);
                              }}
                              placeholder="—"
                              testId={`picker-vendor-${item.id}`}
                            />
                            <div className="flex items-center gap-1.5 pl-1.5">
                              <CrmPicker
                                items={agentContactItems}
                                value={item.vendorAgent || ""}
                                valueName={item.vendorAgent || ""}
                                onSelect={(id, name) => {
                                  inlineUpdate(item.id, "vendorAgent", name || null);
                                  inlineUpdate(item.id, "vendorAgentId", id || null);
                                }}
                                placeholder="agent"
                                testId={`picker-vendor-agent-${item.id}`}
                              />
                              {item.vendorAgent && (() => {
                                const agent = contactByName.get(item.vendorAgent);
                                return (
                                  <>
                                    {agent?.email && (
                                      <a href={`mailto:${agent.email}`} className="text-muted-foreground hover:text-blue-500" title={agent.email} data-testid={`link-agent-email-${item.id}`}>
                                        <Mail className="h-3 w-3" />
                                      </a>
                                    )}
                                    {agent?.phone && (
                                      <a href={`tel:${agent.phone}`} className="text-muted-foreground hover:text-blue-500" title={agent.phone} data-testid={`link-agent-phone-${item.id}`}>
                                        <Phone className="h-3 w-3" />
                                      </a>
                                    )}
                                    {item.vendorAgentId && (
                                      <Link href={`/contacts/${item.vendorAgentId}`} className="text-muted-foreground hover:text-blue-500" title="View profile" data-testid={`link-vendor-agent-profile-${item.id}`}>
                                        <ExternalLink className="h-3 w-3" />
                                      </Link>
                                    )}
                                  </>
                                );
                              })()}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="px-1.5 py-1">
                          <InlineDate
                            value={item.bidDeadline || ""}
                            onSave={v => inlineUpdate(item.id, "bidDeadline", v || null)}
                            className="text-xs"
                          />
                        </TableCell>
                      </>
                    ) : (
                      <>
                        <TableCell className="px-1.5 py-1">
                          <CrmPicker
                            items={companyItems}
                            value={item.buyer || ""}
                            valueName={item.buyer || ""}
                            onSelect={(_id, name) => inlineUpdate(item.id, "buyer", name || null)}
                            placeholder="—"
                            testId={`picker-buyer-${item.id}`}
                          />
                        </TableCell>
                        <TableCell className="px-1.5 py-1">
                          <InlineDate
                            value={item.marketingDate || ""}
                            onSave={v => inlineUpdate(item.id, "marketingDate", v || null)}
                            className="text-xs"
                          />
                        </TableCell>
                      </>
                    )}
                    <TableCell className="px-1.5 py-1 text-right">
                      <InlineNumber
                        value={item.fee}
                        onSave={v => inlineUpdate(item.id, "fee", v)}
                        prefix="£"
                        format={v => v.toLocaleString("en-GB")}
                        className="text-xs text-right"
                      />
                    </TableCell>
                    <TableCell className="px-1.5 py-1">
                      <InlineLabelSelect
                        value={item.status || "Reporting"}
                        options={STATUSES}
                        colorMap={STATUS_LABEL_COLORS}
                        onSave={v => inlineUpdate(item.id, "status", v)}
                      />
                    </TableCell>
                    <TableCell className="px-1.5 py-1">
                      <InlineAgentMultiSelect
                        value={item.agentUserIds || []}
                        users={bgpUsers}
                        onSave={ids => inlineUpdate(item.id, "agentUserIds", ids.length > 0 ? ids : null)}
                        testId={`agent-select-${item.id}`}
                        colorMap={userIdColorMap}
                      />
                    </TableCell>
                    <TableCell className="px-1 py-1 text-center">
                      <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-0.5 px-1" onClick={() => setFilesItem(item)} data-testid={`button-files-${item.id}`}>
                        <Paperclip className="w-3 h-3" />{marketingFileCounts[item.id] || 0}
                      </Button>
                    </TableCell>
                    <TableCell className="px-1 py-1 text-center">
                      <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-0.5 px-1" onClick={() => setViewingsItem(item)} data-testid={`button-viewings-${item.id}`}>
                        <Eye className="w-3 h-3" />{counts?.viewings[item.id] || 0}
                      </Button>
                    </TableCell>
                    <TableCell className="px-1 py-1 text-center">
                      <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-0.5 px-1" onClick={() => setOffersItem(item)} data-testid={`button-offers-${item.id}`}>
                        <FileText className="w-3 h-3" />{counts?.offers[item.id] || 0}
                      </Button>
                    </TableCell>
                    <TableCell className="px-1 py-1 text-center">
                      <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-0.5 px-1" onClick={() => setDistItem(item)} data-testid={`button-sentto-${item.id}`}>
                        <Send className="w-3 h-3" />{counts?.distributions[item.id] || 0}
                      </Button>
                    </TableCell>
                    <TableCell className="px-1.5 py-1">
                      <InlineText
                        value={item.notes || ""}
                        onSave={(val) => inlineUpdate(item.id, "notes", val || null)}
                        className="text-[11px]"
                        multiline
                        maxLines={2}
                      />
                    </TableCell>
                    <TableCell className="px-1.5 py-1">
                      {item.dealId ? (
                        <div className="flex items-center gap-1">
                          <a href={`/deals/${item.dealId}`} className="text-[10px] text-blue-600 hover:underline truncate max-w-[80px]" data-testid={`link-deal-${item.id}`}>
                            {dealMap.get(item.dealId) || "View Deal"}
                          </a>
                          <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={() => unlinkDealMutation.mutate(item.id)} title="Unlink deal" data-testid={`button-unlink-deal-${item.id}`}>
                            <Unlink className="w-3 h-3 text-muted-foreground" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" className="h-6 px-1 text-xs" onClick={() => { setLinkDealOpen(item); setLinkDealId(""); }} title="Link existing deal" data-testid={`button-link-deal-${item.id}`}>
                            <Link2 className="h-3 w-3" />
                          </Button>
                          <Button variant="ghost" size="sm" className="h-6 px-1 text-xs" onClick={() => createDealMutation.mutate(item.id)} title="Auto-create deal" data-testid={`button-create-deal-${item.id}`}>
                            <ArrowRightLeft className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="px-1 py-1">
                      <div className="flex gap-0.5">
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setEditItem(item); setForm(itemToForm(item)); }} data-testid={`button-edit-${item.id}`}>
                          <Pencil className="w-3 h-3" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-red-500" onClick={() => setDeleteItem(item)} data-testid={`button-delete-${item.id}`}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
        </ScrollableTable>
      </Card>

      {/* Create / Edit Dialog */}
      <Dialog open={createOpen || !!editItem} onOpenChange={(open) => { if (!open) { setCreateOpen(false); setEditItem(null); } }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editItem ? "Edit Asset" : `Add ${boardType === "Purchases" ? "Purchase" : "Sale"}`}</DialogTitle>
            <DialogDescription>{editItem ? "Update asset details" : `Add a new ${boardType === "Purchases" ? "purchase opportunity" : "sale instruction"}`}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label className="text-xs">Asset Name *</Label>
              <Input value={form.assetName} onChange={e => setForm({ ...form, assetName: e.target.value })} className="h-9" data-testid="input-asset-name" />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Property (CRM)</Label>
              <CrmPicker
                items={propertyItems}
                value={form.propertyId}
                valueName={propertyMap.get(form.propertyId) || ""}
                onSelect={(id, name) => setForm({ ...form, propertyId: id, assetName: form.assetName || name })}
                placeholder="Select or leave blank to auto-create"
                testId="picker-property"
              />
              <p className="text-[10px] text-muted-foreground mt-0.5">Leave blank to auto-create from asset name</p>
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Address</Label>
              <Input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} className="h-9" data-testid="input-address" />
            </div>
            <div>
              <Label className="text-xs">Asset Class</Label>
              <Select value={form.assetType} onValueChange={v => setForm({ ...form, assetType: v })}>
                <SelectTrigger className="h-9" data-testid="select-asset-type"><SelectValue placeholder="Select class" /></SelectTrigger>
                <SelectContent>{ASSET_CLASSES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Tenure</Label>
              <Select value={form.tenure} onValueChange={v => setForm({ ...form, tenure: v })}>
                <SelectTrigger className="h-9" data-testid="select-tenure"><SelectValue placeholder="Select tenure" /></SelectTrigger>
                <SelectContent>{TENURES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Guide Price (£)</Label>
              <Input type="number" value={form.guidePrice} onChange={e => setForm({ ...form, guidePrice: e.target.value })} className="h-9" data-testid="input-guide-price" />
            </div>
            <div>
              <Label className="text-xs">Sq Ft</Label>
              <Input type="number" value={form.sqft} onChange={e => setForm({ ...form, sqft: e.target.value })} className="h-9" data-testid="input-sqft" />
            </div>
            <div>
              <Label className="text-xs">NIY (%)</Label>
              <Input type="number" step="0.01" value={form.niy} onChange={e => setForm({ ...form, niy: e.target.value })} className="h-9" data-testid="input-niy" />
            </div>
            <div>
              <Label className="text-xs">EQY (%)</Label>
              <Input type="number" step="0.01" value={form.eqy} onChange={e => setForm({ ...form, eqy: e.target.value })} className="h-9" data-testid="input-eqy" />
            </div>
            <div>
              <Label className="text-xs">Current Rent (£ pa)</Label>
              <Input type="number" value={form.currentRent} onChange={e => setForm({ ...form, currentRent: e.target.value })} className="h-9" data-testid="input-current-rent" />
            </div>
            <div>
              <Label className="text-xs">ERV (£ pa)</Label>
              <Input type="number" value={form.ervPa} onChange={e => setForm({ ...form, ervPa: e.target.value })} className="h-9" data-testid="input-erv" />
            </div>
            <div>
              <Label className="text-xs">WAULT to Break (yrs)</Label>
              <Input type="number" step="0.1" value={form.waultBreak} onChange={e => setForm({ ...form, waultBreak: e.target.value })} className="h-9" data-testid="input-wault-break" />
            </div>
            <div>
              <Label className="text-xs">WAULT to Expiry (yrs)</Label>
              <Input type="number" step="0.1" value={form.waultExpiry} onChange={e => setForm({ ...form, waultExpiry: e.target.value })} className="h-9" data-testid="input-wault-expiry" />
            </div>
            <div>
              <Label className="text-xs">Occupancy (%)</Label>
              <Input type="number" step="0.1" value={form.occupancy} onChange={e => setForm({ ...form, occupancy: e.target.value })} className="h-9" data-testid="input-occupancy" />
            </div>
            <div>
              <Label className="text-xs">Capex Required (£)</Label>
              <Input type="number" value={form.capexRequired} onChange={e => setForm({ ...form, capexRequired: e.target.value })} className="h-9" data-testid="input-capex" />
            </div>
            <div>
              <Label className="text-xs">Client (BGP advises)</Label>
              <CrmPicker
                items={companyItems}
                value={form.client}
                valueName={form.client}
                onSelect={(id, name) => setForm({ ...form, client: name, clientId: id })}
                placeholder="Select company"
                testId="picker-client"
              />
            </div>
            <div>
              <Label className="text-xs">Client Contact</Label>
              <CrmPicker
                items={contactItems}
                value={form.clientContact}
                valueName={form.clientContact}
                onSelect={(id, name) => setForm({ ...form, clientContact: name, clientContactId: id })}
                placeholder="Select contact"
                testId="picker-client-contact"
              />
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
                <SelectTrigger className="h-9" data-testid="select-status"><SelectValue /></SelectTrigger>
                <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {boardType === "Purchases" ? (
              <>
                <div>
                  <Label className="text-xs">Vendor</Label>
                  <CrmPicker
                    items={companyItems}
                    value={form.vendor}
                    valueName={form.vendor}
                    onSelect={(id, name) => setForm({ ...form, vendor: name, vendorId: id })}
                    placeholder="Select company"
                    testId="picker-vendor"
                  />
                </div>
                <div>
                  <Label className="text-xs">Vendor Agent</Label>
                  <CrmPicker
                    items={agentContactItems}
                    value={form.vendorAgent}
                    valueName={form.vendorAgent}
                    onSelect={(id, name) => setForm({ ...form, vendorAgent: name, vendorAgentId: id })}
                    placeholder="Select agent"
                    testId="picker-vendor-agent"
                  />
                </div>
                <div>
                  <Label className="text-xs">Bid Deadline</Label>
                  <Input type="date" value={form.bidDeadline} onChange={e => setForm({ ...form, bidDeadline: e.target.value })} className="h-9" data-testid="input-bid-deadline" />
                </div>
              </>
            ) : (
              <>
                <div>
                  <Label className="text-xs">Buyer</Label>
                  <CrmPicker
                    items={companyItems}
                    value={form.buyer}
                    valueName={form.buyer}
                    onSelect={(_id, name) => setForm({ ...form, buyer: name })}
                    placeholder="Select company"
                    testId="picker-buyer"
                  />
                </div>
                <div>
                  <Label className="text-xs">Marketing Date</Label>
                  <Input type="date" value={form.marketingDate} onChange={e => setForm({ ...form, marketingDate: e.target.value })} className="h-9" data-testid="input-marketing-date" />
                </div>
              </>
            )}
            <div>
              <Label className="text-xs">Fee Type</Label>
              <Select value={form.feeType} onValueChange={v => setForm({ ...form, feeType: v })}>
                <SelectTrigger className="h-9" data-testid="select-fee-type"><SelectValue placeholder="Select fee type" /></SelectTrigger>
                <SelectContent>{FEE_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Fee (£)</Label>
              <Input type="number" value={form.fee} onChange={e => setForm({ ...form, fee: e.target.value })} className="h-9" data-testid="input-fee" />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Agent(s)</Label>
              <div className="flex flex-wrap gap-1">
                {bgpUsers.map(u => {
                  const sel = form.agentUserIds.includes(u.id);
                  return (
                    <Badge
                      key={u.id}
                      variant={sel ? "default" : "outline"}
                      className="cursor-pointer text-[10px]"
                      onClick={() => setForm({
                        ...form,
                        agentUserIds: sel ? form.agentUserIds.filter(id => id !== u.id) : [...form.agentUserIds, u.id],
                      })}
                    >
                      {u.name}
                    </Badge>
                  );
                })}
              </div>
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Notes</Label>
              <Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={3} data-testid="input-notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreateOpen(false); setEditItem(null); }}>Cancel</Button>
            <Button
              disabled={!form.assetName}
              onClick={() => {
                if (editItem) {
                  updateMutation.mutate({ id: editItem.id, data: formToPayload(form) });
                } else {
                  createMutation.mutate(formToPayload(form));
                }
              }}
              data-testid="button-save-asset"
            >
              {editItem ? "Save" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleteItem} onOpenChange={(open) => { if (!open) setDeleteItem(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Asset</DialogTitle>
            <DialogDescription>Are you sure you want to delete "{deleteItem?.assetName}"?</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteItem(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteItem && deleteMutation.mutate(deleteItem.id)} data-testid="button-confirm-delete">Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Link WIP Deal dialog */}
      <Dialog open={!!linkDealOpen} onOpenChange={(open) => { if (!open) setLinkDealOpen(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Link to WIP Deal</DialogTitle>
            <DialogDescription>Link "{linkDealOpen?.assetName}" to an existing WIP deal.</DialogDescription>
          </DialogHeader>
          <CrmPicker
            items={dealItems}
            value={linkDealId}
            valueName={dealMap.get(linkDealId) || ""}
            onSelect={(id) => setLinkDealId(id)}
            placeholder="Select deal"
            testId="picker-link-deal"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkDealOpen(null)}>Cancel</Button>
            <Button disabled={!linkDealId} onClick={() => linkDealOpen && linkDealMutation.mutate({ id: linkDealOpen.id, dealId: linkDealId })} data-testid="button-confirm-link-deal">Link Deal</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {viewingsItem && (
        <ViewingsDialog trackerId={viewingsItem.id} assetName={viewingsItem.assetName} open={!!viewingsItem} onClose={() => setViewingsItem(null)} />
      )}
      {offersItem && (
        <OffersDialog trackerId={offersItem.id} assetName={offersItem.assetName} open={!!offersItem} onClose={() => setOffersItem(null)} />
      )}
      {distItem && (
        <DistributionsDialog trackerId={distItem.id} assetName={distItem.assetName} open={!!distItem} onClose={() => setDistItem(null)} />
      )}
      {filesItem && (
        <MarketingFilesDialog trackerId={filesItem.id} assetName={filesItem.assetName} open={!!filesItem} onClose={() => setFilesItem(null)} />
      )}
    </div>
  );
}
