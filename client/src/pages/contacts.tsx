import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Search, Users, AlertCircle, X, Plus, ArrowLeft, Loader2, Pencil, Trash2, Mail, Send, CheckCircle2, Building, UserCircle, Phone, AtSign, Calendar, ArrowUpRight, ArrowDownLeft, Clock, RefreshCw, Video, MessageSquare, Handshake, ClipboardList, Globe, MapPin, Sparkles, UserPlus, Archive, ChevronLeft, ChevronRight, Crown, Linkedin, Zap, Briefcase, TrendingUp } from "lucide-react";
import { useState, useMemo, useRef, useEffect } from "react";
import { trackRecentItem } from "@/hooks/use-recent-items";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { ScrollableTable } from "@/components/scrollable-table";
import { useRoute, Link } from "wouter";
import { apiRequest, queryClient, getQueryFn, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { InlineText, InlineSelect, InlineLabelSelect, InlineMultiLabelSelect } from "@/components/inline-edit";
import { CRM_OPTIONS } from "@/lib/crm-options";
import type { CrmContact, CrmCompany, CrmDeal, CrmProperty, CrmRequirementsLeasing, CrmRequirementsInvestment, CrmInteraction } from "@shared/schema";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EntityPicker } from "@/components/entity-picker";
import { ColumnFilterPopover } from "@/components/column-filter-popover";

function parseAlloc(val: string | string[] | null | undefined): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  try {
    const p = JSON.parse(val);
    return Array.isArray(p) ? p : val ? [val] : [];
  } catch {
    return val ? [val] : [];
  }
}

const CONTACT_STATUS_OPTIONS = ["Active Client", "Company Client Non Active", "Client Targeting", "Occupier"];

const CONTACT_STATUS_COLORS: Record<string, string> = {
  "Active Client": "bg-emerald-500",
  "Company Client Non Active": "bg-amber-500",
  "Client Targeting": "bg-blue-500",
  "Occupier": "bg-purple-500",
};

function getGroupColor(group: string): string {
  return CONTACT_STATUS_COLORS[group] || "bg-gray-500";
}

interface MailRecipient {
  id: string;
  name: string;
  email: string;
}

function MailOutDialog({
  open,
  onOpenChange,
  recipients,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipients: MailRecipient[];
}) {
  const { toast } = useToast();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [removedRecipients, setRemovedRecipients] = useState<Set<string>>(new Set());

  const activeRecipients = recipients.filter(r => !removedRecipients.has(r.id));

  const handleSend = async () => {
    if (activeRecipients.length === 0 || !subject.trim() || !body.trim()) return;
    setSending(true);
    try {
      const htmlBody = body.split("\n").map(line => `<p>${line || "&nbsp;"}</p>`).join("");
      const res = await fetch("/api/user-mail/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        credentials: "include",
        body: JSON.stringify({
          recipients: activeRecipients.map(r => r.email),
          subject,
          body: htmlBody,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to send");
      }
      setSent(true);
      toast({ title: "Emails sent", description: `Sent to ${activeRecipients.length} contact(s)` });
    } catch (err: any) {
      toast({ title: "Send failed", description: err.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const handleClose = () => {
    setSubject("");
    setBody("");
    setSending(false);
    setSent(false);
    setRemovedRecipients(new Set());
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) handleClose(); }}>
      <DialogContent className="max-w-[640px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="w-5 h-5" />
            Mail Out to Contacts
          </DialogTitle>
          <DialogDescription>
            Compose and send an email to {activeRecipients.length} selected contact{activeRecipients.length !== 1 ? "s" : ""} via Outlook
          </DialogDescription>
        </DialogHeader>

        {sent ? (
          <div className="py-8 text-center space-y-3">
            <CheckCircle2 className="w-12 h-12 mx-auto text-green-500" />
            <h3 className="font-semibold text-lg">Emails Sent</h3>
            <p className="text-sm text-muted-foreground">
              Successfully sent to {activeRecipients.length} contact{activeRecipients.length !== 1 ? "s" : ""}
            </p>
            <Button onClick={handleClose} data-testid="button-mail-done">Done</Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs font-medium">To ({activeRecipients.length})</Label>
              <div className="flex flex-wrap gap-1.5 p-2 rounded-md border border-input bg-background min-h-[36px] max-h-[100px] overflow-y-auto">
                {activeRecipients.map((r) => (
                  <Badge
                    key={r.id}
                    variant="secondary"
                    className="text-xs gap-1 pr-1"
                    data-testid={`recipient-badge-${r.id}`}
                  >
                    {r.name}
                    <button
                      className="hover:bg-muted-foreground/20 rounded-full p-0.5"
                      onClick={() => setRemovedRecipients(prev => new Set(prev).add(r.id))}
                      data-testid={`button-remove-recipient-${r.id}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                ))}
                {activeRecipients.length === 0 && (
                  <span className="text-xs text-muted-foreground py-0.5">No recipients — add contacts back or close</span>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="mail-subject" className="text-xs font-medium">Subject</Label>
              <Input
                id="mail-subject"
                placeholder="Email subject..."
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                data-testid="input-mail-subject"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="mail-body" className="text-xs font-medium">Message</Label>
              <Textarea
                id="mail-body"
                placeholder="Write your message here..."
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="min-h-[200px] resize-y"
                data-testid="textarea-mail-body"
              />
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleClose} data-testid="button-mail-cancel">Cancel</Button>
              <Button
                onClick={handleSend}
                disabled={sending || activeRecipients.length === 0 || !subject.trim() || !body.trim()}
                data-testid="button-mail-send"
              >
                {sending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Sending...</>
                ) : (
                  <><Send className="w-4 h-4 mr-2" />Send to {activeRecipients.length} contact{activeRecipients.length !== 1 ? "s" : ""}</>
                )}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ContactFormDialog({
  open,
  onOpenChange,
  contact,
  companies,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact?: CrmContact | null;
  companies?: CrmCompany[];
}) {
  const { toast } = useToast();
  const isEdit = !!contact;
  const [formData, setFormData] = useState({
    name: contact?.name || "",
    groupName: contact?.groupName || "",
    role: contact?.role || "",
    companyId: contact?.companyId || "",
    companyName: contact?.companyName || "",
    email: contact?.email || "",
    phone: contact?.phone || "",
    contactType: contact?.contactType || "",
    agentSpecialty: contact?.agentSpecialty || "",
    bgpAllocation: parseAlloc(contact?.bgpAllocation),
    nextMeetingDate: contact?.nextMeetingDate || "",
    notes: contact?.notes || "",
  });

  const mutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const payload = { ...data, bgpAllocation: JSON.stringify(data.bgpAllocation || []) };
      if (payload.companyId) {
        const comp = companies?.find(c => c.id === payload.companyId);
        if (comp) payload.companyName = comp.name;
      }
      if (isEdit) {
        await apiRequest("PUT", `/api/crm/contacts/${contact.id}`, payload);
      } else {
        await apiRequest("POST", "/api/crm/contacts", payload);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/contacts"] });
      toast({ title: isEdit ? "Contact updated" : "Contact created" });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;
    mutation.mutate(formData);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[540px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Contact" : "New Contact"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Update contact details" : "Add a new contact to the CRM"}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="contact-name" className="text-xs font-medium">Name</Label>
            <Input
              id="contact-name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              data-testid="input-contact-name"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs font-medium">Status</Label>
              <Select value={formData.groupName} onValueChange={(v) => setFormData({ ...formData, groupName: v })}>
                <SelectTrigger data-testid="select-contact-group">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  {CONTACT_STATUS_OPTIONS.map((g) => (
                    <SelectItem key={g} value={g}>{g}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-medium">Type</Label>
              <Select value={formData.contactType} onValueChange={(v) => setFormData({ ...formData, contactType: v })}>
                <SelectTrigger data-testid="select-contact-type">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Client">Client</SelectItem>
                  <SelectItem value="Agent">Agent</SelectItem>
                  <SelectItem value="Landlord">Landlord</SelectItem>
                  <SelectItem value="Tenant">Tenant</SelectItem>
                  <SelectItem value="Investor">Investor</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {(formData.contactType === "Agent" || (formData.companyId && companies?.find(c => c.id === formData.companyId)?.companyType === "Agent")) && (
            <div className="space-y-2">
              <Label className="text-xs font-medium">Agent Specialty</Label>
              <Select value={formData.agentSpecialty} onValueChange={(v) => setFormData({ ...formData, agentSpecialty: v })}>
                <SelectTrigger data-testid="select-agent-specialty">
                  <SelectValue placeholder="Select specialty" />
                </SelectTrigger>
                <SelectContent>
                  {CRM_OPTIONS.agentSpecialty.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs font-medium">Email</Label>
              <Input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                data-testid="input-contact-email"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-medium">Phone</Label>
              <Input
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                data-testid="input-contact-phone"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-medium">Title</Label>
            <Input
              value={formData.role}
              onChange={(e) => setFormData({ ...formData, role: e.target.value })}
              data-testid="input-contact-role"
            />
          </div>
          {companies && companies.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs font-medium">Company</Label>
              <Select value={formData.companyId || "none"} onValueChange={(v) => setFormData({ ...formData, companyId: v === "none" ? "" : v })}>
                <SelectTrigger data-testid="select-contact-company">
                  <SelectValue placeholder="Select company" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No company</SelectItem>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs font-medium">BGP Allocation</Label>
              <div className="flex flex-wrap gap-1.5 min-h-[36px] p-2 border rounded-md">
                {CRM_OPTIONS.contactBgpAllocation.map(opt => {
                  const isSelected = (formData.bgpAllocation || []).includes(opt);
                  const bg = CRM_OPTIONS.bgpTeamColors[opt] || "bg-gray-500";
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => {
                        const current = formData.bgpAllocation || [];
                        const next = isSelected ? current.filter((s: string) => s !== opt) : [...current, opt];
                        setFormData({ ...formData, bgpAllocation: next });
                      }}
                      className={`${bg} text-white text-[11px] font-medium px-2.5 py-1 rounded-full transition-all ${isSelected ? "ring-2 ring-primary ring-offset-1" : "opacity-40 hover:opacity-70"}`}
                      data-testid={`input-contact-alloc-${opt}`}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-medium">Next Meeting Date</Label>
              <Input
                type="date"
                value={formData.nextMeetingDate}
                onChange={(e) => setFormData({ ...formData, nextMeetingDate: e.target.value })}
                data-testid="input-contact-next-meeting"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-medium">Notes</Label>
            <Textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              className="min-h-[80px] resize-y"
              data-testid="textarea-contact-notes"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} data-testid="button-contact-cancel">Cancel</Button>
            <Button type="submit" disabled={mutation.isPending || !formData.name.trim()} data-testid="button-contact-save">
              {mutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : isEdit ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RequirementPicker({
  contactId,
  linkedIds,
  allRequirements,
}: {
  contactId: string;
  linkedIds: string[];
  allRequirements: { id: string; name: string; type: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const linkedItems = allRequirements.filter(r => linkedIds.includes(r.id));
  const filtered = allRequirements.filter(r => !search || r.name.toLowerCase().includes(search.toLowerCase()));

  const linkMutation = useMutation({
    mutationFn: async (req: { id: string; type: string }) => {
      await apiRequest("POST", `/api/crm/contacts/${contactId}/requirements`, {
        requirementId: req.id,
        requirementType: req.type,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/contact-requirement-links"] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: async (requirementId: string) => {
      await apiRequest("DELETE", `/api/crm/contacts/${contactId}/requirements/${requirementId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/contact-requirement-links"] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={dropdownRef}>
      <div className="flex items-center gap-1 flex-wrap min-h-[24px]">
        {linkedItems.map(item => (
          <span key={item.id} className="inline-flex items-center gap-1 bg-muted rounded px-1.5 py-0.5 text-[11px] max-w-[120px] group">
            <ClipboardList className="w-2.5 h-2.5 text-muted-foreground shrink-0" />
            <span className="truncate">{item.name}</span>
            <button onClick={(e) => { e.stopPropagation(); unlinkMutation.mutate(item.id); }} className="opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity">
              <X className="w-2.5 h-2.5" />
            </button>
          </span>
        ))}
        <button onClick={() => setOpen(!open)} className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors px-1 py-0.5 rounded hover:bg-muted">
          <Plus className="w-3 h-3" />
        </button>
      </div>
      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 w-[240px] bg-popover border rounded-md shadow-lg">
          <div className="p-2 border-b">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search requirements..."
                className="w-full pl-7 pr-2 py-1 text-xs bg-transparent border rounded focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
            </div>
          </div>
          <div className="max-h-[200px] overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-3">No requirements found</p>
            ) : (
              filtered.map(item => {
                const linked = linkedIds.includes(item.id);
                return (
                  <button
                    key={item.id}
                    onClick={() => linked ? unlinkMutation.mutate(item.id) : linkMutation.mutate({ id: item.id, type: item.type })}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded transition-colors text-left ${linked ? "bg-primary/10 text-primary" : "hover:bg-muted"}`}
                  >
                    <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${linked ? "bg-primary border-primary" : "border-muted-foreground/30"}`}>
                      {linked && <span className="text-primary-foreground text-[8px] font-bold">✓</span>}
                    </div>
                    <span className="truncate">{item.name}</span>
                    <span className="text-[9px] text-muted-foreground ml-auto">{item.type}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface InteractionData {
  interactions: CrmInteraction[];
  nextMeeting: CrmInteraction | null;
  lastInteraction: CrmInteraction | null;
  total: number;
}

function formatInteractionDate(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays === -1) return "Yesterday";
  if (diffDays > 1 && diffDays <= 7) return `In ${diffDays} days`;
  if (diffDays < -1 && diffDays >= -7) return `${Math.abs(diffDays)} days ago`;

  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
}

// Accepts either a contactId or a companyId so the same UI works on both
// the contact detail page and the brand/company detail page. The contact
// endpoint returns nextMeeting/lastInteraction; the company one doesn't —
// either way we recompute the highlights from the interactions array.
export function InteractionTimeline({ contactId, companyId }: { contactId?: string; companyId?: string }) {
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const queryKey = contactId
    ? ["/api/interactions/contact", contactId]
    : ["/api/interactions/company", companyId!];

  const { data, isLoading } = useQuery<InteractionData>({
    queryKey,
    enabled: !!(contactId || companyId),
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/interactions/sync?daysBack=90&daysForward=60");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const filtered = useMemo(() => {
    if (!data?.interactions) return [];
    if (typeFilter === "all") return data.interactions;
    return data.interactions.filter((i) => i.type === typeFilter);
  }, [data?.interactions, typeFilter]);

  const now = new Date();
  const upcoming = filtered.filter((i) => new Date(i.interactionDate) > now);
  const past = filtered.filter((i) => new Date(i.interactionDate) <= now);

  const nextMeeting = data?.nextMeeting
    ?? (data?.interactions?.find(i => i.type === "meeting" && new Date(i.interactionDate) > now) ?? null);
  const lastInteraction = data?.lastInteraction
    ?? (data?.interactions?.find(i => new Date(i.interactionDate) <= now) ?? null);

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Clock className="w-4 h-4" />
            Interactions
            {data?.total ? <Badge variant="secondary" className="text-xs">{data.total}</Badge> : null}
          </h3>
          <div className="flex items-center gap-2">
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-7 text-xs w-[100px]" data-testid="select-interaction-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="email">Emails</SelectItem>
                <SelectItem value="meeting">Meetings</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
              data-testid="button-sync-interactions"
            >
              <RefreshCw className={`w-3 h-3 mr-1 ${syncMutation.isPending ? "animate-spin" : ""}`} />
              Sync
            </Button>
          </div>
        </div>

        {nextMeeting && (
          <div className="bg-blue-50 dark:bg-blue-950/30 rounded-md p-3 border border-blue-200 dark:border-blue-800">
            <div className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400 font-medium mb-1">
              <Calendar className="w-3 h-3" />
              Next Meeting — {formatInteractionDate(nextMeeting.interactionDate as unknown as string)}
            </div>
            <p className="text-sm font-medium">{nextMeeting.subject}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {new Date(nextMeeting.interactionDate).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
            </p>
          </div>
        )}

        {lastInteraction && !nextMeeting && (
          <div className="bg-muted/50 rounded-md p-3 border">
            <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium mb-1">
              <Clock className="w-3 h-3" />
              Last Interaction — {formatInteractionDate(lastInteraction.interactionDate as unknown as string)}
            </div>
            <p className="text-sm">{lastInteraction.subject}</p>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-6">
            <MessageSquare className="w-8 h-8 mx-auto text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">No interactions found</p>
            <p className="text-xs text-muted-foreground mt-1">Click Sync to scan emails & calendar</p>
          </div>
        ) : (
          <div className="max-h-[calc(100vh-320px)] overflow-y-auto pr-1">
            {upcoming.length > 0 && (
              <div className="mb-3">
                <p className="text-xs font-medium text-blue-600 dark:text-blue-400 mb-2 uppercase tracking-wider">Upcoming</p>
                <div className="space-y-1">
                  {upcoming.map((interaction) => (
                    <InteractionRow key={interaction.id} interaction={interaction} />
                  ))}
                </div>
              </div>
            )}
            {past.length > 0 && (
              <div>
                {upcoming.length > 0 && <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">Past</p>}
                <div className="space-y-1">
                  {past.map((interaction) => (
                    <InteractionRow key={interaction.id} interaction={interaction} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function InteractionRow({ interaction }: { interaction: CrmInteraction }) {
  const [expanded, setExpanded] = useState(false);
  const isEmail = interaction.type === "email";
  const isInbound = interaction.direction === "inbound";
  const isUpcoming = interaction.direction === "upcoming";

  const participants = Array.isArray(interaction.participants) ? interaction.participants as string[] : [];
  const bgpParticipants = participants.filter(p => p.endsWith("@brucegillinghampollard.com"));
  const externalParticipants = participants.filter(p => !p.endsWith("@brucegillinghampollard.com"));

  return (
    <div
      className="rounded-md hover:bg-muted/50 cursor-pointer transition-colors"
      onClick={() => setExpanded(!expanded)}
      data-testid={`row-interaction-${interaction.id}`}
    >
      <div className="flex items-start gap-2 p-2 text-sm">
        <div className={`mt-0.5 p-1 rounded ${isEmail ? "bg-amber-100 dark:bg-amber-900/30 text-amber-600" : "bg-blue-100 dark:bg-blue-900/30 text-blue-600"}`}>
          {isEmail ? <Mail className="w-3 h-3" /> : <Video className="w-3 h-3" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {isEmail && (isInbound ? <ArrowDownLeft className="w-3 h-3 text-green-500 shrink-0" /> : <ArrowUpRight className="w-3 h-3 text-blue-500 shrink-0" />)}
            {!isEmail && isUpcoming && <Clock className="w-3 h-3 text-blue-500 shrink-0" />}
            <p className="font-medium text-xs truncate">{interaction.subject}</p>
          </div>
          {externalParticipants.length > 0 && !expanded && (
            <p className="text-[10px] text-muted-foreground truncate mt-0.5">
              {externalParticipants.slice(0, 2).join(", ")}{externalParticipants.length > 2 ? ` +${externalParticipants.length - 2}` : ""}
            </p>
          )}
          {!expanded && interaction.preview && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">{interaction.preview}</p>
          )}
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] text-muted-foreground">
              {formatInteractionDate(interaction.interactionDate as unknown as string)}
            </span>
            {interaction.bgpUser && (
              <span className="text-[10px] text-muted-foreground">
                via {interaction.bgpUser.split("@")[0]}
              </span>
            )}
            {interaction.matchMethod && interaction.matchMethod !== "email" && (
              <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5">
                {interaction.matchMethod === "keyword_company" ? "keyword" : "name match"}
              </Badge>
            )}
          </div>
        </div>
      </div>

      {expanded && (
        <div className="px-9 pb-3 space-y-2 text-xs border-t mx-2 pt-2" data-testid={`detail-interaction-${interaction.id}`}>
          <div className="flex items-center gap-1 text-muted-foreground">
            <Calendar className="w-3 h-3 shrink-0" />
            <span>{new Date(interaction.interactionDate).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
          </div>

          {externalParticipants.length > 0 && (
            <div>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">External</p>
              <div className="flex flex-wrap gap-1">
                {externalParticipants.map((p, i) => (
                  <Badge key={i} variant="secondary" className="text-[10px] font-normal">{p}</Badge>
                ))}
              </div>
            </div>
          )}

          {bgpParticipants.length > 0 && (
            <div>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">BGP</p>
              <div className="flex flex-wrap gap-1">
                {bgpParticipants.map((p, i) => (
                  <Badge key={i} variant="outline" className="text-[10px] font-normal">{p.split("@")[0]}</Badge>
                ))}
              </div>
            </div>
          )}

          {interaction.preview && (
            <div>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Preview</p>
              <p className="text-xs text-muted-foreground whitespace-pre-wrap">{interaction.preview}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ContactDetail({ id }: { id: string }) {
  const { toast } = useToast();
  const [editOpen, setEditOpen] = useState(false);

  const { data: contact, isLoading } = useQuery<CrmContact>({
    queryKey: ["/api/crm/contacts", id],
  });

  const { data: companies } = useQuery<CrmCompany[]>({
    queryKey: ["/api/crm/companies"],
  });

  const { data: company } = useQuery<CrmCompany | null>({
    queryKey: ["/api/crm/companies", contact?.companyId],
    enabled: !!contact?.companyId,
  });

  const { data: allContacts } = useQuery<CrmContact[]>({
    queryKey: ["/api/crm/contacts"],
  });

  const { data: contactProperties } = useQuery<CrmProperty[]>({
    queryKey: ["/api/crm/contacts", id, "properties"],
  });

  useEffect(() => {
    if (contact) {
      trackRecentItem({ id: contact.id, type: "contact", name: contact.name || "Untitled Contact", subtitle: contact.companyName || undefined });
    }
  }, [contact?.id, contact?.name, contact?.companyName]);

  const { data: contactDeals } = useQuery<any[]>({
    queryKey: ["/api/crm/contacts", id, "deals"],
  });

  const { data: contactRequirements } = useQuery<any[]>({
    queryKey: ["/api/crm/contacts", id, "requirements"],
  });

  const { data: contactInvestmentItems } = useQuery<any[]>({
    queryKey: ["/api/crm/contacts", id, "investment-tracker"],
  });

  const filteredCoworkers = useMemo(() => {
    if (!allContacts || !contact?.companyId) return [];
    return allContacts.filter(c => c.companyId === contact.companyId && c.id !== id);
  }, [allContacts, contact?.companyId, id]);

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/crm/contacts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/contacts"] });
      toast({ title: "Contact deleted" });
      window.history.back();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const enrichMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/apollo/enrich-contact", { contactId: id });
      return res.json();
    },
    onSuccess: (data: any) => {
      if (data.success) {
        queryClient.invalidateQueries({ queryKey: ["/api/crm/contacts", id] });
        queryClient.invalidateQueries({ queryKey: ["/api/crm/contacts"] });
        if (data.updatedFields?.length > 0) {
          toast({ title: "Contact enriched", description: `Updated: ${data.updatedFields.join(", ")}` });
        } else {
          toast({ title: "Already enriched", description: "All available data already present on this contact" });
        }
      } else {
        toast({ title: "No match found", description: "Apollo couldn't find this person — try adding more details like email or company", variant: "destructive" });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Enrichment failed", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[300px]" />
      </div>
    );
  }

  if (!contact) {
    return (
      <div className="p-4 sm:p-6">
        <Card>
          <CardContent className="py-12 text-center">
            <AlertCircle className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <h3 className="font-medium mb-1">Contact not found</h3>
          </CardContent>
        </Card>
      </div>
    );
  }

  const companyAddress = company?.headOfficeAddress as { street?: string; city?: string; country?: string } | null;

  return (
    <div className="p-4 sm:p-6 space-y-6" data-testid="contact-detail">
      <ContactFormDialog open={editOpen} onOpenChange={setEditOpen} contact={contact} companies={companies} />

      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/contacts">
          <Button variant="ghost" size="sm" data-testid="button-back-contacts">
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back
          </Button>
        </Link>
        {contact.avatarUrl ? (
          <img src={contact.avatarUrl} alt={contact.name} className="w-14 h-14 rounded-full bg-muted border-2 border-border" data-testid="avatar-contact-detail" />
        ) : (
          <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center text-lg font-bold text-muted-foreground border-2 border-border" data-testid="avatar-initials-detail">
            {contact.name?.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="flex-1">
          <h1 className="text-xl font-bold" data-testid="text-contact-detail-name">{contact.name}</h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {contact.groupName && (
              <Badge className={`${getGroupColor(contact.groupName)} text-white text-xs`}>
                {contact.groupName}
              </Badge>
            )}
            {(() => {
              const derivedType = contact.companyId && company?.companyType ? company.companyType : contact.contactType;
              if (!derivedType) return null;
              const colorClass = CRM_OPTIONS.companyTypeColors[derivedType] || "bg-gray-500";
              return <Badge className={`${colorClass} text-white text-xs`}>{derivedType}</Badge>;
            })()}
            {contact.agentSpecialty && (
              <Badge className={`${CRM_OPTIONS.agentSpecialtyColors[contact.agentSpecialty] || "bg-gray-500"} text-white text-xs`}>{contact.agentSpecialty}</Badge>
            )}
            {contact.bgpClient && <Badge className="bg-black text-white dark:bg-white dark:text-black text-xs">BGP Client</Badge>}
            {parseAlloc(contact.bgpAllocation).length > 0 && parseAlloc(contact.bgpAllocation).map(alloc => (
              <Badge key={alloc} className={`${CRM_OPTIONS.bgpTeamColors[alloc] || "bg-gray-500"} text-white text-xs`}>
                {alloc}
              </Badge>
            ))}
            {contact.role && <Badge variant="outline" className="text-xs">{contact.role}</Badge>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => enrichMutation.mutate()}
            disabled={enrichMutation.isPending}
            data-testid="button-enrich-contact"
          >
            {enrichMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Zap className="w-4 h-4 mr-1" />}
            Enrich
          </Button>
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)} data-testid="button-edit-contact">
            <Pencil className="w-4 h-4 mr-1" />
            Edit
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (confirm("Delete this contact?")) deleteMutation.mutate();
            }}
            data-testid="button-delete-contact"
          >
            <Trash2 className="w-4 h-4 mr-1" />
            Delete
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardContent className="p-4 space-y-3">
              <h3 className="font-semibold text-sm">Contact Details</h3>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                {contact.email && (
                  <div>
                    <p className="text-xs text-muted-foreground">Email</p>
                    <a href={`mailto:${contact.email}`} className="text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1" data-testid="link-contact-email">
                      <AtSign className="w-3 h-3" />{contact.email}
                    </a>
                  </div>
                )}
                {contact.phone && (
                  <div>
                    <p className="text-xs text-muted-foreground">Phone</p>
                    <a href={`tel:${contact.phone}`} className="text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1" data-testid="link-contact-phone">
                      <Phone className="w-3 h-3" />{contact.phone}
                    </a>
                  </div>
                )}
                {company && (
                  <div>
                    <p className="text-xs text-muted-foreground">Company</p>
                    <Link href={`/companies/${company.id}`}>
                      <span className="text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer" data-testid="link-contact-company">
                        <Building className="w-3 h-3" />{company.name}
                      </span>
                    </Link>
                  </div>
                )}
                {contact.linkedinUrl && (
                  <div>
                    <p className="text-xs text-muted-foreground">LinkedIn</p>
                    <a href={contact.linkedinUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1" data-testid="link-contact-linkedin">
                      <Linkedin className="w-3 h-3" />{contact.linkedinUrl.replace(/^https?:\/\/(www\.)?linkedin\.com\/in\//, '').replace(/\/$/, '')}
                    </a>
                  </div>
                )}
                {company?.domainUrl && (
                  <div>
                    <p className="text-xs text-muted-foreground">Website</p>
                    <a href={company.domainUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1" data-testid="link-contact-website">
                      <Globe className="w-3 h-3" />{company.domainUrl.replace(/^https?:\/\//, '')}
                    </a>
                  </div>
                )}
                {companyAddress && (companyAddress.street || companyAddress.city) && (
                  <div className="col-span-2">
                    <p className="text-xs text-muted-foreground">Office Address</p>
                    <p className="flex items-center gap-1 text-sm" data-testid="text-contact-address">
                      <MapPin className="w-3 h-3 text-muted-foreground shrink-0" />
                      {[companyAddress.street, companyAddress.city, companyAddress.country].filter(Boolean).join(", ")}
                    </p>
                  </div>
                )}
              </div>
              {contact.notes && (
                <div className="pt-2 border-t">
                  <p className="text-xs text-muted-foreground mb-1">Notes</p>
                  <p className="text-sm whitespace-pre-wrap" data-testid="text-contact-notes">{contact.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {contactProperties && contactProperties.length > 0 && (
            <Card>
              <CardContent className="p-4 space-y-3">
                <h3 className="font-semibold text-sm flex items-center gap-2">
                  <Building className="w-4 h-4" />
                  Linked Properties
                  <Badge variant="secondary" className="text-[10px] ml-1">{contactProperties.length}</Badge>
                </h3>
                <div className="space-y-1">
                  {contactProperties.map(prop => (
                    <Link key={prop.id} href={`/properties/${prop.id}`}>
                      <div className="flex items-center gap-2 p-2 rounded-md hover:bg-muted cursor-pointer transition-colors" data-testid={`link-property-${prop.id}`}>
                        <Building className="w-4 h-4 text-muted-foreground shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{prop.name}</p>
                          <div className="flex items-center gap-2">
                            {prop.bgpEngagement && (Array.isArray(prop.bgpEngagement) ? prop.bgpEngagement : [prop.bgpEngagement]).length > 0 && <span className="text-[10px] text-muted-foreground">{Array.isArray(prop.bgpEngagement) ? prop.bgpEngagement.join(", ") : prop.bgpEngagement}</span>}
                            {prop.assetClass && <Badge variant="outline" className="text-[10px] px-1 py-0">{prop.assetClass}</Badge>}
                          </div>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {contactDeals && contactDeals.length > 0 && (() => {
            const agentDeals = contactDeals.filter((d: any) => d.linkSource === "agent");
            const linkedDeals = contactDeals.filter((d: any) => d.linkSource !== "agent");
            return (
              <>
                {agentDeals.length > 0 && (
                  <Card>
                    <CardContent className="p-4 space-y-3">
                      <h3 className="font-semibold text-sm flex items-center gap-2">
                        <Briefcase className="w-4 h-4 text-emerald-500" />
                        Agent — Deals
                        <Badge variant="secondary" className="text-[10px] ml-1 bg-emerald-100 text-emerald-700">{agentDeals.length}</Badge>
                      </h3>
                      <p className="text-xs text-muted-foreground">Deals where this contact is an agent or key contact</p>
                      <div className="space-y-1">
                        {agentDeals.map((deal: any) => (
                          <Link key={deal.id} href={`/deals/${deal.id}`}>
                            <div className="flex items-center gap-2 p-2 rounded-md hover:bg-muted cursor-pointer transition-colors" data-testid={`link-agent-deal-${deal.id}`}>
                              <Handshake className="w-4 h-4 text-emerald-400 shrink-0" />
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium truncate">{deal.name}</p>
                                <div className="flex items-center gap-2 flex-wrap">
                                  {deal.agentRoles?.map((role: string) => (
                                    <Badge key={role} className="text-[9px] px-1 py-0 bg-emerald-100 text-emerald-700">{role}</Badge>
                                  ))}
                                  {deal.status && <Badge variant="outline" className="text-[10px] px-1 py-0">{deal.status}</Badge>}
                                  {deal.dealType && <Badge variant="outline" className="text-[10px] px-1 py-0">{deal.dealType}</Badge>}
                                </div>
                              </div>
                            </div>
                          </Link>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
                {linkedDeals.length > 0 && (
                  <Card>
                    <CardContent className="p-4 space-y-3">
                      <h3 className="font-semibold text-sm flex items-center gap-2">
                        <Handshake className="w-4 h-4" />
                        Linked Deals
                        <Badge variant="secondary" className="text-[10px] ml-1">{linkedDeals.length}</Badge>
                      </h3>
                      <div className="space-y-1">
                        {linkedDeals.map((deal: any) => (
                          <Link key={deal.id} href={`/deals/${deal.id}`}>
                            <div className="flex items-center gap-2 p-2 rounded-md hover:bg-muted cursor-pointer transition-colors" data-testid={`link-deal-${deal.id}`}>
                              <Handshake className="w-4 h-4 text-muted-foreground shrink-0" />
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium truncate">{deal.name}</p>
                                <div className="flex items-center gap-2">
                                  {deal.status && <span className="text-[10px] text-muted-foreground">{deal.status}</span>}
                                  {deal.dealType && <Badge variant="outline" className="text-[10px] px-1 py-0">{deal.dealType}</Badge>}
                                </div>
                              </div>
                            </div>
                          </Link>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            );
          })()}

          {contactInvestmentItems && contactInvestmentItems.length > 0 && (
            <Card>
              <CardContent className="p-4 space-y-3">
                <h3 className="font-semibold text-sm flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-blue-500" />
                  Investment Tracker
                  <Badge variant="secondary" className="text-[10px] ml-1 bg-blue-100 text-blue-700">{contactInvestmentItems.length}</Badge>
                </h3>
                <p className="text-xs text-muted-foreground">Properties on the investment tracker linked to this contact</p>
                <div className="space-y-1">
                  {contactInvestmentItems.map((item: any) => (
                    <Link key={item.id} href={`/investment-tracker?highlight=${item.id}`}>
                      <div className="flex items-center gap-2 p-2 rounded-md hover:bg-muted cursor-pointer transition-colors" data-testid={`link-investment-${item.id}`}>
                        <Building className="w-4 h-4 text-blue-400 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{item.assetName}</p>
                          <div className="flex items-center gap-2 flex-wrap">
                            {item.agentRoles?.map((role: string) => (
                              <Badge key={role} className="text-[9px] px-1 py-0 bg-blue-100 text-blue-700">{role}</Badge>
                            ))}
                            {item.status && <Badge variant="outline" className="text-[10px] px-1 py-0">{item.status}</Badge>}
                            {item.guidePrice && <span className="text-[10px] text-muted-foreground">£{Number(item.guidePrice).toLocaleString()}</span>}
                          </div>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {contactRequirements && contactRequirements.length > 0 && (() => {
            const agentReqs = contactRequirements.filter((r: any) => r.linkSource === "agent");
            const linkedReqs = contactRequirements.filter((r: any) => r.linkSource !== "agent");
            return (
              <>
                {agentReqs.length > 0 && (
                  <Card>
                    <CardContent className="p-4 space-y-3">
                      <h3 className="font-semibold text-sm flex items-center gap-2">
                        <Handshake className="w-4 h-4 text-purple-500" />
                        Tenant Rep — Client Requirements
                        <Badge variant="secondary" className="text-[10px] ml-1 bg-purple-100 text-purple-700">{agentReqs.length}</Badge>
                      </h3>
                      <p className="text-xs text-muted-foreground">Requirements where this contact is the tenant rep agent</p>
                      <div className="space-y-1">
                        {agentReqs.map((req: any) => (
                          <Link key={req.id} href={`/requirements?highlight=${req.id}`}>
                            <div className="flex items-center gap-2 p-2 rounded-md hover:bg-muted cursor-pointer transition-colors" data-testid={`link-agent-requirement-${req.id}`}>
                              <ClipboardList className="w-4 h-4 text-purple-400 shrink-0" />
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium truncate">{req.name}</p>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <Badge variant="outline" className="text-[10px] px-1 py-0">{req.requirementType}</Badge>
                                  {req.status && <Badge variant="outline" className="text-[10px] px-1 py-0">{req.status}</Badge>}
                                  {req.use?.length > 0 && <span className="text-[10px] text-muted-foreground">{req.use.join(", ")}</span>}
                                </div>
                              </div>
                            </div>
                          </Link>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
                {linkedReqs.length > 0 && (
                  <Card>
                    <CardContent className="p-4 space-y-3">
                      <h3 className="font-semibold text-sm flex items-center gap-2">
                        <ClipboardList className="w-4 h-4" />
                        Linked Requirements
                        <Badge variant="secondary" className="text-[10px] ml-1">{linkedReqs.length}</Badge>
                      </h3>
                      <div className="space-y-1">
                        {linkedReqs.map((req: any) => (
                          <Link key={req.id} href={`/requirements?highlight=${req.id}`}>
                            <div className="flex items-center gap-2 p-2 rounded-md hover:bg-muted cursor-pointer transition-colors" data-testid={`link-requirement-${req.id}`}>
                              <ClipboardList className="w-4 h-4 text-muted-foreground shrink-0" />
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium truncate">{req.name}</p>
                                <div className="flex items-center gap-2">
                                  {req.requirementType && <Badge variant="outline" className="text-[10px] px-1 py-0">{req.requirementType}</Badge>}
                                </div>
                              </div>
                            </div>
                          </Link>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            );
          })()}

          <InteractionTimeline contactId={id} />
        </div>

        <div className="space-y-6">
          {filteredCoworkers.length > 0 && (
            <Card>
              <CardContent className="p-4 space-y-3">
                <h3 className="font-semibold text-sm flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  Co-workers at {company?.name || "Company"}
                  <Badge variant="secondary" className="text-[10px] ml-1">{filteredCoworkers.length}</Badge>
                </h3>
                <div className="space-y-1 max-h-[400px] overflow-y-auto">
                  {filteredCoworkers.map(cw => (
                    <Link key={cw.id} href={`/contacts/${cw.id}`}>
                      <div className="flex items-center gap-2 p-2 rounded-md hover:bg-muted cursor-pointer transition-colors" data-testid={`link-coworker-${cw.id}`}>
                        <UserCircle className="w-4 h-4 text-muted-foreground shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{cw.name}</p>
                          <p className="text-xs text-muted-foreground truncate">{cw.role || cw.email || ""}</p>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {(contact.companyId || contact.companyName) && (
            <Card>
              <CardContent className="p-4 space-y-3">
                <h3 className="font-semibold text-sm flex items-center gap-2">
                  <Building className="w-4 h-4" />
                  Company
                </h3>
                {contact.companyId ? (
                  <Link href={`/companies/${contact.companyId}`}>
                    <div className="flex items-center gap-2 p-2 rounded-md hover:bg-muted cursor-pointer transition-colors" data-testid="link-contact-company-card">
                      <Building className="w-4 h-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">{company?.name || contact.companyName}</p>
                        {company?.companyType && (
                          <Badge className={`${CRM_OPTIONS.companyTypeColors[company.companyType] || "bg-gray-500"} text-white text-[10px] mt-0.5`}>
                            {company.companyType}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </Link>
                ) : (
                  <p className="text-sm">{contact.companyName}</p>
                )}
                {company?.domainUrl && (
                  <a href={company.domainUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 p-2 rounded-md hover:bg-muted text-sm text-blue-600 dark:text-blue-400 hover:underline transition-colors">
                    <Globe className="w-4 h-4 shrink-0" />
                    {company.domainUrl.replace(/^https?:\/\//, '')}
                  </a>
                )}
                {companyAddress && (companyAddress.street || companyAddress.city) && (
                  <div className="flex items-center gap-2 p-2 text-sm text-muted-foreground">
                    <MapPin className="w-4 h-4 shrink-0" />
                    {[companyAddress.street, companyAddress.city, companyAddress.country].filter(Boolean).join(", ")}
                  </div>
                )}
                {(company?.bgpContactUserIds?.length || company?.bgpContactCrm) && (
                  <div className="flex items-center gap-2 p-2 text-sm">
                    <UserCircle className="w-4 h-4 text-muted-foreground shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">BGP Contacts</p>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {(company?.bgpContactUserIds?.length ? company.bgpContactUserIds : company?.bgpContactCrm ? [company.bgpContactCrm] : []).map((name: string) => (
                          <Badge key={name} variant="secondary" className="text-[10px] px-1.5 py-0">{name}</Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Contacts() {
  const [, params] = useRoute("/contacts/:id");
  if (params?.id) {
    return <ContactDetail id={params.id} />;
  }

  const urlParams = new URLSearchParams(window.location.search);
  const teamParam = urlParams.get("team");
  const tab = urlParams.get("tab");

  if (tab === "archive") {
    return <InteractionArchive />;
  }

  return <ContactList teamFilter={teamParam} />;
}

const INTERNAL_BGP_TEAMS = new Set(CRM_OPTIONS.dealTeam.filter((t: string) => t !== "Landsec"));

function ContactList({ teamFilter }: { teamFilter?: string | null }) {
  const [search, setSearch] = useState("");
  const [activeGroup, setActiveGroup] = useState("all");
  const [allocationFilter, setAllocationFilter] = useState(teamFilter || "all");
  const [bgpClientFilter, setBgpClientFilter] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [mailDialogOpen, setMailDialogOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<CrmContact | null>(null);
  const [columnFilters, setColumnFilters] = useState<Record<string, string[]>>({});
  const { toast } = useToast();

  const { data: currentUser } = useQuery<{ team?: string; name?: string; email?: string }>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });
  const isClientTeam = !!currentUser?.team && !INTERNAL_BGP_TEAMS.has(currentUser.team) && currentUser.team !== "All";

  const toggleColumnFilter = (column: string, value: string) => {
    setColumnFilters((prev) => {
      const current = prev[column] || [];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { ...prev, [column]: next };
    });
  };

  const { data: contacts, isLoading, error } = useQuery<CrmContact[]>({
    queryKey: ["/api/crm/contacts"],
  });

  const { data: companies } = useQuery<CrmCompany[]>({
    queryKey: ["/api/crm/companies"],
  });

  const { data: msStatus } = useQuery<{ connected: boolean }>({
    queryKey: ["/api/user-mail/status"],
  });

  const { data: interactionSummary } = useQuery<{
    nextMeetings: Record<string, { date: string; subject: string }>;
    lastInteractions: Record<string, { date: string; type: string }>;
  }>({
    queryKey: ["/api/interactions/summary"],
  });

  const { data: allProperties } = useQuery<CrmProperty[]>({
    queryKey: ["/api/crm/properties"],
  });
  const { data: allDeals } = useQuery<CrmDeal[]>({
    queryKey: ["/api/crm/deals"],
  });
  const { data: reqLeasing } = useQuery<CrmRequirementsLeasing[]>({
    queryKey: ["/api/crm/requirements-leasing"],
  });
  const { data: reqInvestment } = useQuery<CrmRequirementsInvestment[]>({
    queryKey: ["/api/crm/requirements-investment"],
  });
  const { data: contactPropertyLinks } = useQuery<{ contactId: string; propertyId: string }[]>({
    queryKey: ["/api/crm/contact-property-links"],
  });
  const { data: contactDealLinks } = useQuery<{ contactId: string; dealId: string }[]>({
    queryKey: ["/api/crm/contact-deal-links"],
  });
  const { data: contactReqLinks } = useQuery<{ contactId: string; requirementId: string; requirementType: string }[]>({
    queryKey: ["/api/crm/contact-requirement-links"],
  });

  const propertyIdsByContact = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const l of contactPropertyLinks || []) {
      if (!map[l.contactId]) map[l.contactId] = [];
      map[l.contactId].push(l.propertyId);
    }
    return map;
  }, [contactPropertyLinks]);

  const dealIdsByContact = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const l of contactDealLinks || []) {
      if (!map[l.contactId]) map[l.contactId] = [];
      map[l.contactId].push(l.dealId);
    }
    return map;
  }, [contactDealLinks]);

  const reqIdsByContact = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const l of contactReqLinks || []) {
      if (!map[l.contactId]) map[l.contactId] = [];
      map[l.contactId].push(l.requirementId);
    }
    return map;
  }, [contactReqLinks]);

  const allRequirements = useMemo(() => {
    const leasing = (reqLeasing || []).map(r => ({ id: r.id, name: r.name, type: "leasing" }));
    const investment = (reqInvestment || []).map(r => ({ id: r.id, name: r.name, type: "investment" }));
    return [...leasing, ...investment];
  }, [reqLeasing, reqInvestment]);

  const inlineSaveMutation = useMutation({
    mutationFn: async ({ id, field, value }: { id: string; field: string; value: string | number | boolean | null }) => {
      await apiRequest("PUT", `/api/crm/contacts/${id}`, { [field]: value });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/contacts"] });
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const syncInteractions = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/interactions/sync?daysBack=90&daysForward=60");
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/interactions/summary"] });
      toast({
        title: "Interactions synced",
        description: `Found ${data?.synced?.emails || 0} emails and ${data?.synced?.calendar || 0} calendar events`,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Sync failed", description: err.message, variant: "destructive" });
    },
  });

  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [discoverStats, setDiscoverStats] = useState<{ scannedUsers: number; totalEmails: number } | null>(null);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(new Set());
  const [addedEmails, setAddedEmails] = useState<Set<string>>(new Set());
  const [bulkEnrichOpen, setBulkEnrichOpen] = useState(false);
  const [bulkEnrichResults, setBulkEnrichResults] = useState<any>(null);

  const discoverMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/contacts/discover-from-email?daysBack=90");
      return res.json();
    },
    onSuccess: (data: any) => {
      setSuggestions(data.suggestions || []);
      setDiscoverStats({ scannedUsers: data.scannedUsers, totalEmails: data.totalEmails });
      setSelectedSuggestions(new Set());
      setAddedEmails(new Set());
    },
    onError: (err: Error) => {
      toast({ title: "Discovery failed", description: err.message, variant: "destructive" });
    },
  });

  const bulkEnrichMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/apollo/bulk-enrich");
      return res.json();
    },
    onSuccess: (data: any) => {
      setBulkEnrichResults(data);
      queryClient.invalidateQueries({ queryKey: ["/api/crm/contacts"] });
      toast({
        title: "Bulk enrichment complete",
        description: `${data.enriched} enriched · ${data.noMatch} no match · ${data.skipped} already complete`,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Bulk enrichment failed", description: err.message, variant: "destructive" });
    },
  });

  const addContactMutation = useMutation({
    mutationFn: async (suggestion: { email: string; name: string; domain: string }) => {
      const nameParts = suggestion.name.split(" ");
      const contactData: any = {
        name: suggestion.name,
        email: suggestion.email,
        groupName: "Client Targeting",
      };
      if (suggestion.domain) {
        contactData.companyName = suggestion.domain.replace(/\.\w+$/, "").replace(/\./g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
      }
      await apiRequest("POST", "/api/crm/contacts", contactData);
      return suggestion.email;
    },
    onSuccess: (email: string) => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/contacts"] });
      setAddedEmails((prev) => new Set([...prev, email]));
      toast({ title: "Contact added to CRM" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to add contact", description: err.message, variant: "destructive" });
    },
  });

  const bulkAddMutation = useMutation({
    mutationFn: async (items: { email: string; name: string; domain: string }[]) => {
      for (const item of items) {
        const contactData: any = {
          name: item.name,
          email: item.email,
          groupName: "Client Targeting",
        };
        if (item.domain) {
          contactData.companyName = item.domain.replace(/\.\w+$/, "").replace(/\./g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
        }
        await apiRequest("POST", "/api/crm/contacts", contactData);
      }
      return items.length;
    },
    onSuccess: (count: number) => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/contacts"] });
      const added = suggestions.filter((s) => selectedSuggestions.has(s.email));
      setAddedEmails((prev) => new Set([...prev, ...added.map((s: any) => s.email)]));
      setSelectedSuggestions(new Set());
      toast({ title: `${count} contacts added to CRM` });
    },
    onError: (err: Error) => {
      toast({ title: "Bulk add failed", description: err.message, variant: "destructive" });
    },
  });

  const groups = useMemo(() => {
    if (!contacts) return [];
    const groupSet = new Map<string, number>();
    CONTACT_STATUS_OPTIONS.forEach(s => groupSet.set(s, 0));
    contacts.forEach((c) => {
      const g = c.groupName;
      if (g && CONTACT_STATUS_COLORS[g]) {
        groupSet.set(g, (groupSet.get(g) || 0) + 1);
      }
    });
    return Array.from(groupSet.entries())
      .filter(([, count]) => count > 0)
      .map(([name, count]) => ({ name, count }));
  }, [contacts]);

  const companyTypeMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (companies) {
      for (const co of companies) {
        if (co.companyType) map[co.id] = co.companyType;
      }
    }
    return map;
  }, [companies]);

  const getContactType = (contact: CrmContact) => {
    if (contact.companyId && companyTypeMap[contact.companyId]) {
      return companyTypeMap[contact.companyId];
    }
    return contact.contactType || null;
  };

  const isAgentContact = (contact: CrmContact) => {
    const derivedType = getContactType(contact);
    return derivedType === "Agent" || contact.contactType === "Agent";
  };

  const contactTypes = useMemo(() => {
    if (!contacts) return [];
    const types = new Set<string>();
    contacts.forEach((c) => {
      const t = getContactType(c);
      if (t) types.add(t);
    });
    return Array.from(types).sort();
  }, [contacts, companyTypeMap]);

  const allocations = useMemo(() => {
    if (!contacts) return [];
    const allocs = new Set<string>();
    contacts.forEach((c) => {
      const cAllocs = parseAlloc(c.bgpAllocation);
      if (cAllocs.length > 0) {
        cAllocs.forEach(a => allocs.add(a));
      }
    });
    return Array.from(allocs).sort();
  }, [contacts]);

  const filteredContacts = useMemo(() => {
    if (!contacts) return [];
    return contacts.filter((c) => {
      if (activeGroup !== "all" && (c.groupName || "Uncategorized") !== activeGroup) return false;
      if (allocationFilter !== "all" && !parseAlloc(c.bgpAllocation).includes(allocationFilter)) return false;
      if (bgpClientFilter && !c.bgpClient) return false;
      if ((columnFilters.status?.length || 0) > 0 && !columnFilters.status.includes(c.groupName || "")) return false;
      if ((columnFilters.type?.length || 0) > 0) {
        const derivedType = getContactType(c);
        if (!derivedType || !columnFilters.type.includes(derivedType)) return false;
      }
      if (search) {
        const s = search.toLowerCase();
        return (
          c.name.toLowerCase().includes(s) ||
          (c.email || "").toLowerCase().includes(s) ||
          (c.phone || "").toLowerCase().includes(s) ||
          (c.companyName || "").toLowerCase().includes(s) ||
          (c.role || "").toLowerCase().includes(s) ||
          (c.notes || "").toLowerCase().includes(s)
        );
      }
      return true;
    });
  }, [contacts, activeGroup, allocationFilter, bgpClientFilter, search, columnFilters, companyTypeMap]);

  const selectedContacts = filteredContacts.filter(c => selectedIds.has(c.id));
  const mailRecipients: MailRecipient[] = selectedContacts
    .map(c => ({ id: c.id, name: c.name, email: c.email || "" }))
    .filter(r => r.email);

  const toggleSelectAll = () => {
    const allFilteredIds = filteredContacts.map(c => c.id);
    const allSelected = allFilteredIds.every(id => selectedIds.has(id));
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allFilteredIds));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleOpenMailOut = () => {
    if (mailRecipients.length === 0) {
      toast({
        title: "No email addresses",
        description: "The selected contacts don't have email addresses",
        variant: "destructive",
      });
      return;
    }
    setMailDialogOpen(true);
  };

  const allFilteredSelected = filteredContacts.length > 0 && filteredContacts.every(c => selectedIds.has(c.id));

  if (error) {
    return (
      <div className="p-4 sm:p-6">
        <div className="flex items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">People Hub</h1>
            <p className="text-sm text-muted-foreground">CRM Contacts</p>
          </div>
        </div>
        <Card>
          <CardContent className="py-12 text-center">
            <AlertCircle className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <h3 className="font-medium mb-1">Could not load Contacts</h3>
            <p className="text-sm text-muted-foreground">Please try again later.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const clearAllFilters = () => {
    setSearch("");
    setActiveGroup("all");
    setAllocationFilter("all");
    setBgpClientFilter(false);
    setColumnFilters({});
  };

  const hasActiveFilters = search || activeGroup !== "all" || allocationFilter !== "all" || bgpClientFilter || Object.values(columnFilters).some((f) => f.length > 0);

  const statusCounts = useMemo(() => {
    if (!contacts) return {};
    const counts: Record<string, number> = {};
    contacts.forEach((c) => {
      const g = c.groupName || "Uncategorized";
      counts[g] = (counts[g] || 0) + 1;
    });
    return counts;
  }, [contacts]);

  const contactTypeCounts = useMemo(() => {
    if (!contacts) return {};
    const counts: Record<string, number> = {};
    contacts.forEach((c) => {
      const t = getContactType(c) || "Uncategorised";
      counts[t] = (counts[t] || 0) + 1;
    });
    return counts;
  }, [contacts, companyTypeMap]);

  const CONTACT_STAT_CARDS: { label: string; filter: { field: "group" | "type" | null; value: string | null }; icon: any; color: string; activeColor: string }[] = [
    { label: "All Contacts", filter: { field: null, value: null }, icon: Users, color: "bg-blue-600", activeColor: "bg-blue-800 ring-2 ring-blue-400" },
    { label: "Active Clients", filter: { field: "group", value: "Active Client" }, icon: CheckCircle2, color: "bg-emerald-600", activeColor: "bg-emerald-800 ring-2 ring-emerald-400" },
    { label: "Client Targeting", filter: { field: "group", value: "Client Targeting" }, icon: UserPlus, color: "bg-sky-600", activeColor: "bg-sky-800 ring-2 ring-sky-400" },
    { label: "Occupiers", filter: { field: "group", value: "Occupier" }, icon: Building, color: "bg-purple-600", activeColor: "bg-purple-800 ring-2 ring-purple-400" },
    { label: "Agents", filter: { field: "type", value: "Agent" }, icon: Handshake, color: "bg-indigo-600", activeColor: "bg-indigo-800 ring-2 ring-indigo-400" },
    { label: "Landlords", filter: { field: "type", value: "Landlord" }, icon: Crown, color: "bg-amber-600", activeColor: "bg-amber-800 ring-2 ring-amber-400" },
  ];

  const handleContactStatClick = (filter: { field: "group" | "type" | null; value: string | null }) => {
    if (filter.field === null) {
      clearAllFilters();
    } else if (filter.field === "group") {
      if (activeGroup === filter.value) {
        setActiveGroup("all");
      } else {
        setActiveGroup(filter.value || "all");
      }
      setColumnFilters((prev) => { const { type: _, ...rest } = prev; return rest; });
    } else if (filter.field === "type") {
      setActiveGroup("all");
      const currentType = columnFilters.type || [];
      if (currentType.length === 1 && currentType[0] === filter.value) {
        setColumnFilters((prev) => { const { type: _, ...rest } = prev; return rest; });
      } else {
        setColumnFilters({ ...columnFilters, type: [filter.value!] });
      }
    }
  };

  const isContactStatActive = (filter: { field: "group" | "type" | null; value: string | null }) => {
    if (filter.field === null) return activeGroup === "all" && !columnFilters.type?.length;
    if (filter.field === "group") return activeGroup === filter.value;
    if (filter.field === "type") return columnFilters.type?.length === 1 && columnFilters.type[0] === filter.value;
    return false;
  };

  return (
    <div className="p-4 sm:p-6 space-y-6" data-testid="contacts-page">
      <MailOutDialog
        open={mailDialogOpen}
        onOpenChange={setMailDialogOpen}
        recipients={mailRecipients}
      />
      <ContactFormDialog open={createOpen} onOpenChange={setCreateOpen} companies={companies} />
      <ContactFormDialog open={!!editingContact} onOpenChange={(open) => { if (!open) setEditingContact(null); }} contact={editingContact} companies={companies} />

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Users className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">People Hub</h1>
            <p className="text-sm text-muted-foreground">
              {contacts?.length || 0} contacts in CRM{teamFilter ? ` · Filtered by ${teamFilter} team` : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link href="/contacts?tab=archive">
            <Button variant="outline" size="sm" data-testid="button-interaction-archive">
              <Archive className="w-4 h-4 mr-1" />
              Interaction Archive
            </Button>
          </Link>
          {selectedIds.size > 0 && (
            <Button
              variant="default"
              size="sm"
              onClick={handleOpenMailOut}
              disabled={!msStatus?.connected}
              data-testid="button-mail-out"
            >
              <Mail className="w-4 h-4 mr-2" />
              Mail Out ({selectedIds.size})
            </Button>
          )}
          {selectedIds.size > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedIds(new Set())}
              data-testid="button-clear-selection"
            >
              <X className="w-3.5 h-3.5 mr-1" />
              Clear
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => syncInteractions.mutate()}
            disabled={syncInteractions.isPending}
            data-testid="button-sync-interactions"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${syncInteractions.isPending ? "animate-spin" : ""}`} />
            {syncInteractions.isPending ? "Syncing..." : "Sync Interactions"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setDiscoverOpen(true); discoverMutation.mutate(); }}
            disabled={discoverMutation.isPending}
            data-testid="button-discover-contacts"
          >
            <Sparkles className={`w-4 h-4 mr-2 ${discoverMutation.isPending ? "animate-pulse" : ""}`} />
            {discoverMutation.isPending ? "Scanning..." : "Discover Contacts"}
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="button-create-contact">
            <Plus className="w-4 h-4 mr-2" />
            New Contact
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <div className="flex gap-3 flex-wrap">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-16 flex-1 min-w-[130px]" />
            ))}
          </div>
          <Skeleton className="h-10" />
          <Skeleton className="h-[400px]" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {CONTACT_STAT_CARDS.filter((card) => {
              if (isClientTeam && card.label === "Landlords") return false;
              return true;
            }).map((card) => {
              const isActive = isContactStatActive(card.filter);
              const count = card.filter.field === null
                ? (contacts?.length || 0)
                : card.filter.field === "group"
                  ? (statusCounts[card.filter.value!] || 0)
                  : (contactTypeCounts[card.filter.value!] || 0);
              return (
                <div
                  key={card.label}
                  className="cursor-pointer"
                  onClick={() => handleContactStatClick(card.filter)}
                  data-testid={`stat-${card.label.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <Card className={`overflow-hidden transition-all ${isActive ? "ring-2 ring-primary" : "hover:shadow-md"}`}>
                    <CardContent className="p-3">
                      <div className="flex items-center gap-2">
                        <div className={`w-8 h-8 rounded-lg ${isActive ? card.activeColor : card.color} flex items-center justify-center`}>
                          <card.icon className="w-4 h-4 text-white" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-lg font-bold leading-tight">{count}</p>
                          <p className="text-[10px] text-muted-foreground truncate leading-tight">{card.label}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search contacts..."
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="input-search-contacts"
              />
            </div>
            {allocations.length > 0 && (
              <Select value={allocationFilter} onValueChange={setAllocationFilter}>
                <SelectTrigger className="w-[160px]" data-testid="select-allocation-filter">
                  <SelectValue placeholder="All teams" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Teams</SelectItem>
                  {allocations.map((a) => (
                    <SelectItem key={a} value={a}>{a}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              variant={bgpClientFilter ? "default" : "outline"}
              size="sm"
              onClick={() => setBgpClientFilter(!bgpClientFilter)}
              className={bgpClientFilter ? "bg-black text-white hover:bg-black/90 dark:bg-white dark:text-black dark:hover:bg-white/90" : ""}
              data-testid="button-bgp-client-filter"
            >
              <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
              BGP Clients
            </Button>
            {hasActiveFilters && (
              <Button variant="outline" size="sm" onClick={clearAllFilters} data-testid="button-clear-filters">
                <X className="w-3.5 h-3.5 mr-1" />
                Clear
              </Button>
            )}
            <div className="text-xs text-muted-foreground">
              {filteredContacts.length} of {contacts?.length || 0} contacts
            </div>
          </div>

          {filteredContacts.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Users className="w-10 h-10 mx-auto text-muted-foreground mb-3 opacity-30" />
                <h3 className="font-medium mb-1">No contacts found</h3>
                <p className="text-sm text-muted-foreground">
                  {hasActiveFilters ? "Try adjusting your search or filters" : "Add your first contact to get started"}
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <ScrollableTable minWidth={2200}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10 sticky left-0 bg-background z-10">
                        <Checkbox
                          checked={allFilteredSelected}
                          onCheckedChange={toggleSelectAll}
                          data-testid="checkbox-select-all"
                        />
                      </TableHead>
                      <TableHead className="w-8 sticky left-[40px] bg-background z-10"></TableHead>
                      <TableHead className="min-w-[140px] max-w-[160px] font-medium sticky left-[72px] bg-background z-10">Contact</TableHead>
                      <TableHead className="min-w-[100px]">Title</TableHead>
                      <TableHead className="min-w-[120px]">Company</TableHead>
                      <TableHead className="min-w-[120px]">
                        <ColumnFilterPopover
                          label="Status"
                          options={CONTACT_STATUS_OPTIONS}
                          activeFilters={columnFilters.status || []}
                          onToggleFilter={(v) => toggleColumnFilter("status", v)}
                        />
                      </TableHead>
                      <TableHead className="min-w-[100px]">
                        <ColumnFilterPopover
                          label="Type"
                          options={contactTypes}
                          activeFilters={columnFilters.type || []}
                          onToggleFilter={(v) => toggleColumnFilter("type", v)}
                        />
                      </TableHead>
                      <TableHead className="min-w-[110px]">Specialty</TableHead>
                      <TableHead className="min-w-[160px]">Email</TableHead>
                      <TableHead className="min-w-[120px]">Phone</TableHead>
                      <TableHead className="min-w-[80px] text-center">BGP Client</TableHead>
                      <TableHead className="min-w-[120px]">BGP Team</TableHead>
                      <TableHead className="min-w-[160px]">Properties</TableHead>
                      <TableHead className="min-w-[160px]">WIP</TableHead>
                      <TableHead className="min-w-[160px]">Requirements</TableHead>
                      <TableHead className="min-w-[180px]">Notes</TableHead>
                      <TableHead className="min-w-[110px]">Next Meeting</TableHead>
                      <TableHead className="min-w-[110px]">Last Interaction</TableHead>
                      <TableHead className="min-w-[80px] text-center">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredContacts.map((contact) => (
                      <TableRow key={contact.id} className="text-xs" data-testid={`row-contact-${contact.id}`}>
                        <TableCell className="px-1.5 py-1 w-10 sticky left-0 bg-background z-10">
                          <Checkbox
                            checked={selectedIds.has(contact.id)}
                            onCheckedChange={() => toggleSelect(contact.id)}
                            onClick={(e) => e.stopPropagation()}
                            data-testid={`checkbox-contact-${contact.id}`}
                          />
                        </TableCell>
                        <TableCell className="px-1.5 py-1 w-8 pr-0 sticky left-[40px] bg-background z-10">
                          <div
                            className={`w-2.5 h-2.5 rounded-full ${getGroupColor(contact.groupName || "")}`}
                            title={contact.groupName || "No status"}
                          />
                        </TableCell>
                        <TableCell className="px-1.5 py-1 font-medium max-w-[200px] sticky left-[72px] bg-background z-10">
                          <Link href={`/contacts/${contact.id}`}>
                            <div className="flex items-center gap-2 hover:underline cursor-pointer">
                              {contact.avatarUrl ? (
                                <img src={contact.avatarUrl} alt={contact.name} className="w-7 h-7 rounded-full flex-shrink-0 bg-muted" data-testid={`avatar-contact-${contact.id}`} />
                              ) : (
                                <div className="w-7 h-7 rounded-full flex-shrink-0 bg-muted flex items-center justify-center text-xs font-semibold text-muted-foreground" data-testid={`avatar-initials-${contact.id}`}>
                                  {contact.name?.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                                </div>
                              )}
                              <span data-testid={`text-contact-name-${contact.id}`}>{contact.name}</span>
                            </div>
                          </Link>
                        </TableCell>
                        <TableCell className="px-1.5 py-1">
                          <InlineText
                            value={contact.role}
                            onSave={(v) => inlineSaveMutation.mutate({ id: contact.id, field: "role", value: v })}
                            placeholder="—"
                            data-testid={`inline-role-${contact.id}`}
                          />
                        </TableCell>
                        <TableCell className="px-1.5 py-1">
                          {contact.companyId ? (
                            <Link href={`/companies/${contact.companyId}`}>
                              <span className="hover:underline cursor-pointer text-blue-600 dark:text-blue-400" data-testid={`link-company-${contact.id}`}>
                                {contact.companyName || "View"}
                              </span>
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">{contact.companyName || ""}</span>
                          )}
                        </TableCell>
                        <TableCell className="px-1.5 py-1" onClick={(e) => e.stopPropagation()}>
                          <InlineLabelSelect
                            value={contact.groupName}
                            options={CONTACT_STATUS_OPTIONS}
                            colorMap={CONTACT_STATUS_COLORS}
                            onSave={(v) => inlineSaveMutation.mutate({ id: contact.id, field: "groupName", value: v })}
                            placeholder="Set status"
                          />
                        </TableCell>
                        <TableCell className="px-1.5 py-1">
                          {(() => {
                            const derivedType = getContactType(contact);
                            if (!derivedType) return <span className="text-muted-foreground">—</span>;
                            const colorClass = CRM_OPTIONS.companyTypeColors[derivedType] || "bg-gray-500";
                            return (
                              <Badge className={`${colorClass} text-white text-[10px] px-1.5 py-0`} data-testid={`type-badge-${contact.id}`}>
                                {derivedType}
                              </Badge>
                            );
                          })()}
                        </TableCell>
                        <TableCell className="px-1.5 py-1">
                          {isAgentContact(contact) ? (
                            <InlineLabelSelect
                              value={contact.agentSpecialty}
                              options={CRM_OPTIONS.agentSpecialty}
                              colorMap={CRM_OPTIONS.agentSpecialtyColors}
                              onSave={(v) => inlineSaveMutation.mutate({ id: contact.id, field: "agentSpecialty", value: v })}
                              placeholder="Set specialty"
                              data-testid={`inline-specialty-${contact.id}`}
                            />
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="px-1.5 py-1">
                          <InlineText
                            value={contact.email}
                            onSave={(v) => inlineSaveMutation.mutate({ id: contact.id, field: "email", value: v })}
                            placeholder="—"
                            data-testid={`inline-email-${contact.id}`}
                          />
                        </TableCell>
                        <TableCell className="px-1.5 py-1">
                          <InlineText
                            value={contact.phone}
                            onSave={(v) => inlineSaveMutation.mutate({ id: contact.id, field: "phone", value: v })}
                            placeholder="—"
                            data-testid={`inline-phone-${contact.id}`}
                          />
                        </TableCell>
                        <TableCell className="px-1.5 py-1 text-center" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => inlineSaveMutation.mutate({ id: contact.id, field: "bgpClient", value: !contact.bgpClient })}
                            className={`w-7 h-7 rounded-full border-2 transition-all duration-200 flex items-center justify-center ${
                              contact.bgpClient
                                ? "bg-black border-black text-white dark:bg-white dark:border-white dark:text-black"
                                : "bg-transparent border-muted-foreground/30 text-transparent hover:border-muted-foreground/50"
                            }`}
                            title={contact.bgpClient ? "BGP Client — click to remove" : "Click to mark as BGP Client"}
                            data-testid={`toggle-bgp-client-${contact.id}`}
                          >
                            {contact.bgpClient && <CheckCircle2 className="w-4 h-4" />}
                          </button>
                        </TableCell>
                        <TableCell className="px-1.5 py-1" onClick={(e) => e.stopPropagation()}>
                          <InlineMultiLabelSelect
                            value={parseAlloc(contact.bgpAllocation)}
                            options={CRM_OPTIONS.contactBgpAllocation}
                            colorMap={CRM_OPTIONS.bgpTeamColors}
                            onSave={(v) => inlineSaveMutation.mutate({ id: contact.id, field: "bgpAllocation", value: JSON.stringify(v || []) })}
                            placeholder="Set teams"
                          />
                        </TableCell>
                        <TableCell className="px-1.5 py-1" onClick={(e) => e.stopPropagation()}>
                          <EntityPicker
                            contactId={contact.id}
                            linkedIds={propertyIdsByContact[contact.id] || []}
                            allItems={(allProperties || []).map(p => ({ id: p.id, name: p.name }))}
                            entityType="properties"
                            icon={<Building className="w-2.5 h-2.5" />}
                            invalidateKey="/api/crm/contact-property-links"
                            searchPlaceholder="Search properties..."
                          />
                        </TableCell>
                        <TableCell className="px-1.5 py-1" onClick={(e) => e.stopPropagation()}>
                          <EntityPicker
                            contactId={contact.id}
                            linkedIds={dealIdsByContact[contact.id] || []}
                            allItems={(allDeals || []).map(d => ({ id: d.id, name: d.name }))}
                            entityType="deals"
                            icon={<Handshake className="w-2.5 h-2.5" />}
                            invalidateKey="/api/crm/contact-deal-links"
                            searchPlaceholder="Search deals..."
                            idField="dealId"
                          />
                        </TableCell>
                        <TableCell className="px-1.5 py-1" onClick={(e) => e.stopPropagation()}>
                          <RequirementPicker
                            contactId={contact.id}
                            linkedIds={reqIdsByContact[contact.id] || []}
                            allRequirements={allRequirements}
                          />
                        </TableCell>
                        <TableCell className="px-1.5 py-1" onClick={(e) => e.stopPropagation()}>
                          <InlineText
                            value={contact.notes}
                            onSave={(v) => inlineSaveMutation.mutate({ id: contact.id, field: "notes", value: v })}
                            placeholder="Add note..."
                            data-testid={`inline-notes-${contact.id}`}
                            maxLines={2}
                            multiline
                          />
                        </TableCell>
                        <TableCell className="px-1.5 py-1">
                          {interactionSummary?.nextMeetings?.[contact.id] ? (
                            <Link href={`/contacts/${contact.id}`}>
                              <div className="cursor-pointer hover:underline">
                                <p className="text-xs font-medium text-blue-600 dark:text-blue-400 flex items-center gap-1">
                                  <Calendar className="w-3 h-3" />
                                  {formatInteractionDate(interactionSummary.nextMeetings[contact.id].date)}
                                </p>
                                <p className="text-[10px] text-muted-foreground truncate max-w-[100px]">
                                  {interactionSummary.nextMeetings[contact.id].subject}
                                </p>
                              </div>
                            </Link>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="px-1.5 py-1">
                          {interactionSummary?.lastInteractions?.[contact.id] ? (
                            <div>
                              <p className="text-xs flex items-center gap-1">
                                {interactionSummary.lastInteractions[contact.id].type === "email" ? (
                                  <Mail className="w-3 h-3 text-amber-500" />
                                ) : (
                                  <Video className="w-3 h-3 text-blue-500" />
                                )}
                                {formatInteractionDate(interactionSummary.lastInteractions[contact.id].date)}
                              </p>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="px-1 py-1 text-center" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-center gap-0.5">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => setEditingContact(contact)}
                              data-testid={`button-edit-contact-${contact.id}`}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={async () => {
                                if (!confirm("Delete this contact?")) return;
                                try {
                                  await apiRequest("DELETE", `/api/crm/contacts/${contact.id}`);
                                  queryClient.invalidateQueries({ queryKey: ["/api/crm/contacts"] });
                                  toast({ title: "Contact deleted" });
                                } catch {
                                  toast({ title: "Failed to delete", variant: "destructive" });
                                }
                              }}
                              data-testid={`button-delete-contact-${contact.id}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollableTable>
            </Card>
          )}
        </>
      )}

      <Dialog open={discoverOpen} onOpenChange={setDiscoverOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5" />
              Discover Contacts from Email
            </DialogTitle>
            <DialogDescription>
              Scans all BGP team members' Microsoft 365 emails to find frequently contacted people not yet in your CRM.
              {discoverStats && (
                <span className="ml-2 text-xs">
                  Scanned {discoverStats.scannedUsers} users, {discoverStats.totalEmails.toLocaleString()} emails
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          {discoverMutation.isPending ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Scanning all team mailboxes... this may take a minute</p>
            </div>
          ) : suggestions.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No new contacts found</p>
              <p className="text-xs mt-1">All frequently emailed contacts are already in your CRM</p>
            </div>
          ) : (
            <>
              {selectedSuggestions.size > 0 && (
                <div className="flex items-center gap-3 px-4 py-2 bg-muted rounded-lg">
                  <span className="text-sm font-medium">{selectedSuggestions.size} selected</span>
                  <Button
                    size="sm"
                    onClick={() => {
                      const items = suggestions.filter((s) => selectedSuggestions.has(s.email) && !addedEmails.has(s.email));
                      bulkAddMutation.mutate(items);
                    }}
                    disabled={bulkAddMutation.isPending}
                    data-testid="button-bulk-add-contacts"
                  >
                    <UserPlus className="w-4 h-4 mr-1" />
                    {bulkAddMutation.isPending ? "Adding..." : "Add Selected to CRM"}
                  </Button>
                </div>
              )}
              <ScrollArea className="max-h-[50vh]">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="w-[40px]">
                        <Checkbox
                          checked={selectedSuggestions.size === suggestions.filter((s) => !addedEmails.has(s.email)).length && suggestions.filter((s) => !addedEmails.has(s.email)).length > 0}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedSuggestions(new Set(suggestions.filter((s) => !addedEmails.has(s.email)).map((s) => s.email)));
                            } else {
                              setSelectedSuggestions(new Set());
                            }
                          }}
                          data-testid="checkbox-select-all-suggestions"
                        />
                      </TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead className="text-center">Frequency</TableHead>
                      <TableHead>BGP Team</TableHead>
                      <TableHead className="w-[80px]">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {suggestions.map((s: any) => {
                      const isAdded = addedEmails.has(s.email);
                      return (
                        <TableRow key={s.email} className={isAdded ? "opacity-50" : ""} data-testid={`row-suggestion-${s.email}`}>
                          <TableCell>
                            <Checkbox
                              checked={selectedSuggestions.has(s.email)}
                              disabled={isAdded}
                              onCheckedChange={(checked) => {
                                const next = new Set(selectedSuggestions);
                                if (checked) next.add(s.email); else next.delete(s.email);
                                setSelectedSuggestions(next);
                              }}
                            />
                          </TableCell>
                          <TableCell>
                            <div className="font-medium text-sm" data-testid={`text-suggestion-name-${s.email}`}>{s.name}</div>
                          </TableCell>
                          <TableCell>
                            <span className="text-sm text-muted-foreground">{s.email}</span>
                          </TableCell>
                          <TableCell>
                            {s.domain ? (
                              <Badge variant="outline" className="text-[10px]">{s.domain}</Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant="secondary" className="text-xs">{s.frequency}</Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {s.bgpUsers?.slice(0, 3).map((u: string) => (
                                <Badge key={u} variant="outline" className="text-[10px] capitalize">{u}</Badge>
                              ))}
                              {s.bgpUsers?.length > 3 && (
                                <Badge variant="outline" className="text-[10px]">+{s.bgpUsers.length - 3}</Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            {isAdded ? (
                              <Badge variant="default" className="text-[10px] bg-green-600">
                                <CheckCircle2 className="w-3 h-3 mr-1" />Added
                              </Badge>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => addContactMutation.mutate(s)}
                                disabled={addContactMutation.isPending}
                                data-testid={`button-add-suggestion-${s.email}`}
                              >
                                <UserPlus className="w-3.5 h-3.5 mr-1" />
                                Add
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </ScrollArea>
              <div className="text-xs text-muted-foreground text-center">
                Showing top {suggestions.length} contacts with 2+ email interactions across all BGP mailboxes
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface ArchiveInteraction extends CrmInteraction {
  contactName?: string;
  companyName?: string;
}

function InteractionArchive() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [directionFilter, setDirectionFilter] = useState("all");
  const [page, setPage] = useState(0);
  const pageSize = 50;

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => { setPage(0); }, [debouncedSearch, typeFilter, directionFilter]);

  const queryParams = useMemo(() => {
    const p = new URLSearchParams();
    p.set("limit", String(pageSize));
    p.set("offset", String(page * pageSize));
    if (typeFilter !== "all") p.set("type", typeFilter);
    if (directionFilter !== "all") p.set("direction", directionFilter);
    if (debouncedSearch) p.set("search", debouncedSearch);
    return p.toString();
  }, [page, typeFilter, directionFilter, debouncedSearch]);

  const { data, isLoading } = useQuery<{ interactions: ArchiveInteraction[]; total: number }>({
    queryKey: ["/api/interactions/archive", queryParams],
    queryFn: async () => {
      const res = await fetch(`/api/interactions/archive?${queryParams}`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load archive");
      return res.json();
    },
  });

  const totalPages = Math.ceil((data?.total || 0) / pageSize);

  return (
    <div className="p-4 sm:p-6 space-y-6" data-testid="interaction-archive">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Link href="/contacts">
            <Button variant="ghost" size="sm" data-testid="button-back-contacts">
              <ArrowLeft className="w-4 h-4 mr-1" />
              Contacts
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-archive-title">
              <Archive className="w-5 h-5 inline mr-2" />
              Interaction Archive
            </h1>
            <p className="text-sm text-muted-foreground">
              {data?.total || 0} interactions tracked
            </p>
          </div>
        </div>
      </div>

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search subject or content..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9"
                data-testid="input-archive-search"
              />
            </div>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-9 w-[120px]" data-testid="select-archive-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="email">Emails</SelectItem>
                <SelectItem value="meeting">Meetings</SelectItem>
              </SelectContent>
            </Select>
            <Select value={directionFilter} onValueChange={setDirectionFilter}>
              <SelectTrigger className="h-9 w-[130px]" data-testid="select-archive-direction">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Directions</SelectItem>
                <SelectItem value="inbound">Inbound</SelectItem>
                <SelectItem value="outbound">Outbound</SelectItem>
                <SelectItem value="upcoming">Upcoming</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16" />)}
            </div>
          ) : !data?.interactions?.length ? (
            <div className="text-center py-12">
              <MessageSquare className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">No interactions found</p>
            </div>
          ) : (
            <div className="divide-y">
              {data.interactions.map((interaction) => (
                <ArchiveInteractionRow key={interaction.id} interaction={interaction} />
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-xs text-muted-foreground">
                Page {page + 1} of {totalPages} · {data?.total} total
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7"
                  disabled={page === 0}
                  onClick={() => setPage(p => p - 1)}
                  data-testid="button-archive-prev"
                >
                  <ChevronLeft className="w-3 h-3 mr-1" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7"
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage(p => p + 1)}
                  data-testid="button-archive-next"
                >
                  Next
                  <ChevronRight className="w-3 h-3 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ArchiveInteractionRow({ interaction }: { interaction: ArchiveInteraction }) {
  const [expanded, setExpanded] = useState(false);
  const isEmail = interaction.type === "email";
  const isInbound = interaction.direction === "inbound";
  const isUpcoming = interaction.direction === "upcoming";

  const participants = Array.isArray(interaction.participants) ? interaction.participants as string[] : [];
  const bgpParticipants = participants.filter(p => p.endsWith("@brucegillinghampollard.com"));
  const externalParticipants = participants.filter(p => !p.endsWith("@brucegillinghampollard.com"));

  return (
    <div
      className="rounded-md hover:bg-muted/50 cursor-pointer transition-colors py-1"
      onClick={() => setExpanded(!expanded)}
      data-testid={`archive-row-${interaction.id}`}
    >
      <div className="flex items-start gap-3 p-2 text-sm">
        <div className={`mt-0.5 p-1.5 rounded ${isEmail ? "bg-amber-100 dark:bg-amber-900/30 text-amber-600" : "bg-blue-100 dark:bg-blue-900/30 text-blue-600"}`}>
          {isEmail ? <Mail className="w-3.5 h-3.5" /> : <Video className="w-3.5 h-3.5" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {isEmail && (isInbound ? <ArrowDownLeft className="w-3 h-3 text-green-500 shrink-0" /> : <ArrowUpRight className="w-3 h-3 text-blue-500 shrink-0" />)}
            {!isEmail && isUpcoming && <Clock className="w-3 h-3 text-blue-500 shrink-0" />}
            <p className="font-medium text-sm truncate">{interaction.subject}</p>
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {interaction.contactName && (
              <Link href={`/contacts/${interaction.contactId}`} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                <Badge variant="secondary" className="text-[10px] hover:bg-primary/20 cursor-pointer">
                  <UserCircle className="w-2.5 h-2.5 mr-0.5" />
                  {interaction.contactName}
                </Badge>
              </Link>
            )}
            {interaction.companyName && (
              <Badge variant="outline" className="text-[10px]">
                <Building className="w-2.5 h-2.5 mr-0.5" />
                {interaction.companyName}
              </Badge>
            )}
            {externalParticipants.length > 0 && !expanded && (
              <span className="text-[10px] text-muted-foreground truncate">
                {externalParticipants.slice(0, 2).join(", ")}{externalParticipants.length > 2 ? ` +${externalParticipants.length - 2}` : ""}
              </span>
            )}
          </div>
          {!expanded && interaction.preview && (
            <p className="text-xs text-muted-foreground truncate mt-1">{interaction.preview}</p>
          )}
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] text-muted-foreground">
              {new Date(interaction.interactionDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
            </span>
            {interaction.bgpUser && (
              <span className="text-[10px] text-muted-foreground">
                via {interaction.bgpUser.split("@")[0]}
              </span>
            )}
          </div>
        </div>
      </div>

      {expanded && (
        <div className="px-10 pb-3 space-y-2 text-xs border-t mx-2 pt-2">
          {externalParticipants.length > 0 && (
            <div>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">External Participants</p>
              <div className="flex flex-wrap gap-1">
                {externalParticipants.map((p, i) => (
                  <Badge key={i} variant="secondary" className="text-[10px] font-normal">{p}</Badge>
                ))}
              </div>
            </div>
          )}

          {bgpParticipants.length > 0 && (
            <div>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">BGP Team</p>
              <div className="flex flex-wrap gap-1">
                {bgpParticipants.map((p, i) => (
                  <Badge key={i} variant="outline" className="text-[10px] font-normal">{p.split("@")[0]}</Badge>
                ))}
              </div>
            </div>
          )}

          {interaction.preview && (
            <div>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Preview</p>
              <p className="text-xs text-muted-foreground whitespace-pre-wrap">{interaction.preview}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
