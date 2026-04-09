import { useQuery, useMutation } from "@tanstack/react-query";
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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Search, AlertCircle, X, UserPlus, Plus, Pencil, Trash2, ArrowRightCircle, Users } from "lucide-react";
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { ScrollableTable } from "@/components/scrollable-table";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { InlineText, InlineSelect } from "@/components/inline-edit";
import { ColumnFilterPopover } from "@/components/column-filter-popover";
import { CRM_OPTIONS } from "@/lib/crm-options";
import { Link } from "wouter";
import type { CrmLead, CrmContact } from "@shared/schema";

export default function Leads() {
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [columnFilters, setColumnFilters] = useState<Record<string, string[]>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [editItem, setEditItem] = useState<CrmLead | null>(null);
  const [deleteItem, setDeleteItem] = useState<CrmLead | null>(null);
  const { toast } = useToast();

  const { data: items = [], isLoading, error } = useQuery<CrmLead[]>({
    queryKey: ["/api/crm/leads"],
  });

  const { data: crmContacts = [] } = useQuery<CrmContact[]>({
    queryKey: ["/api/crm/contacts"],
  });

  const contactMatchMap = useMemo(() => {
    const map = new Map<string, CrmContact[]>();
    items.forEach(lead => {
      const matches = crmContacts.filter(c => {
        if (lead.email && c.email && lead.email.toLowerCase() === c.email.toLowerCase()) return true;
        if (lead.name && c.name) {
          const ln = lead.name.toLowerCase().trim();
          const cn = c.name.toLowerCase().trim();
          if (ln.length > 3 && cn.length > 3 && (ln === cn || ln.includes(cn) || cn.includes(ln))) return true;
        }
        return false;
      });
      if (matches.length > 0) map.set(lead.id, matches);
    });
    return map;
  }, [items, crmContacts]);

  const convertMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("POST", `/api/crm/leads/${id}/convert-to-contact`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/contacts"] });
      toast({ title: "Lead converted to CRM contact" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const createMutation = useMutation({
    mutationFn: (data: Partial<CrmLead>) =>
      apiRequest("POST", "/api/crm/leads", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/leads"] });
      setCreateOpen(false);
      toast({ title: "Lead created" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CrmLead> }) =>
      apiRequest("PUT", `/api/crm/leads/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/leads"] });
      setEditItem(null);
      toast({ title: "Lead updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/crm/leads/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/leads"] });
      setDeleteItem(null);
      toast({ title: "Lead deleted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const groups = useMemo(() => {
    const set = new Set<string>();
    items.forEach((i) => { if (i.groupName) set.add(i.groupName); });
    return Array.from(set).sort();
  }, [items]);

  const statuses = useMemo(() => {
    const set = new Set<string>();
    items.forEach((i) => { if (i.status) set.add(i.status); });
    return Array.from(set).sort();
  }, [items]);

  const leadTypes = useMemo(() => {
    const set = new Set<string>();
    items.forEach((i) => { if (i.leadType) set.add(i.leadType); });
    return Array.from(set).sort();
  }, [items]);

  const toggleColumnFilter = (column: string, value: string) => {
    setColumnFilters((prev) => {
      const current = prev[column] || [];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { ...prev, [column]: next };
    });
  };

  const hasColumnFilters = Object.values(columnFilters).some((f) => f.length > 0);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (groupFilter !== "all" && item.groupName !== groupFilter) return false;
      if (columnFilters.status?.length && !columnFilters.status.includes(item.status || "")) return false;
      if (columnFilters.type?.length && !columnFilters.type.includes(item.leadType || "")) return false;
      if (search) {
        const s = search.toLowerCase();
        return (
          item.name.toLowerCase().includes(s) ||
          item.email?.toLowerCase().includes(s) ||
          item.source?.toLowerCase().includes(s) ||
          item.notes?.toLowerCase().includes(s) ||
          item.assignedTo?.toLowerCase().includes(s)
        );
      }
      return true;
    });
  }, [items, groupFilter, columnFilters, search]);

  const groupCounts = useMemo(() => {
    const map: Record<string, number> = {};
    items.forEach((i) => {
      const g = i.groupName || "Ungrouped";
      map[g] = (map[g] || 0) + 1;
    });
    return map;
  }, [items]);

  const handleInlineSave = (id: string, field: string, value: any) => {
    updateMutation.mutate({ id, data: { [field]: value } });
  };

  const clearAllFilters = () => {
    setSearch("");
    setGroupFilter("all");
    setColumnFilters({});
  };

  if (error) {
    return (
      <div className="p-4 sm:p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Leads</h1>
          <p className="text-sm text-muted-foreground">CRM Lead management</p>
        </div>
        <Card>
          <CardContent className="py-12 text-center">
            <AlertCircle className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <h3 className="font-medium mb-1">Could not load Leads</h3>
            <p className="text-sm text-muted-foreground">Please check the API connection.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6" data-testid="leads-page">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Leads</h1>
          <p className="text-sm text-muted-foreground">
            CRM Leads — {items.length} total
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="button-create-lead">
          <Plus className="w-4 h-4 mr-1" />
          Add Lead
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <div className="flex gap-3">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-16 flex-1" />
            ))}
          </div>
          <Skeleton className="h-10" />
          <Skeleton className="h-[400px]" />
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 flex-wrap">
            {Object.entries(groupCounts).map(([group, count]) => (
              <Card
                key={group}
                className={`flex-1 min-w-[130px] cursor-pointer transition-colors ${
                  groupFilter === group ? "border-primary bg-primary/5" : ""
                }`}
                onClick={() => setGroupFilter(groupFilter === group ? "all" : group)}
                data-testid={`card-lead-group-${group}`}
              >
                <CardContent className="p-3">
                  <p className="text-lg font-bold">{count}</p>
                  <p className="text-xs text-muted-foreground truncate">{group}</p>
                </CardContent>
              </Card>
            ))}
            {Object.keys(groupCounts).length > 0 && (
              <Card
                className={`flex-1 min-w-[130px] cursor-pointer transition-colors ${
                  groupFilter === "all" ? "border-primary bg-primary/5" : ""
                }`}
                onClick={() => setGroupFilter("all")}
                data-testid="card-lead-group-all"
              >
                <CardContent className="p-3">
                  <div className="flex items-center gap-2">
                    <UserPlus className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <p className="text-lg font-bold">{items.length}</p>
                      <p className="text-xs text-muted-foreground">All</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search leads..."
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="input-search-leads"
              />
            </div>
            {(search || groupFilter !== "all" || hasColumnFilters) && (
              <Button
                variant="outline"
                size="sm"
                onClick={clearAllFilters}
                data-testid="button-clear-lead-filters"
              >
                <X className="w-3.5 h-3.5 mr-1" />
                Clear
              </Button>
            )}
            <div className="text-xs text-muted-foreground">
              {filteredItems.length} of {items.length} leads
            </div>
          </div>

          {filteredItems.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <UserPlus className="w-10 h-10 mx-auto text-muted-foreground mb-3 opacity-30" />
                <h3 className="font-medium mb-1">No leads found</h3>
                <p className="text-sm text-muted-foreground">
                  {search || groupFilter !== "all" || hasColumnFilters
                    ? "Try adjusting your search or filters"
                    : "No leads in the database yet"}
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <ScrollableTable minWidth={1200}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[180px]">Name</TableHead>
                      <TableHead className="min-w-[120px]">Group</TableHead>
                      <TableHead className="min-w-[100px]">
                        <ColumnFilterPopover
                          label="Status"
                          options={statuses}
                          activeFilters={columnFilters.status || []}
                          onToggleFilter={(v) => toggleColumnFilter("status", v)}
                        />
                      </TableHead>
                      <TableHead className="min-w-[100px]">
                        <ColumnFilterPopover
                          label="Type"
                          options={leadTypes}
                          activeFilters={columnFilters.type || []}
                          onToggleFilter={(v) => toggleColumnFilter("type", v)}
                        />
                      </TableHead>
                      <TableHead className="min-w-[120px]">Assigned To</TableHead>
                      <TableHead className="min-w-[100px]">Source</TableHead>
                      <TableHead className="min-w-[150px]">Email</TableHead>
                      <TableHead className="min-w-[120px]">Phone</TableHead>
                      <TableHead className="min-w-[80px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredItems.map((item) => (
                      <TableRow key={item.id} data-testid={`row-lead-${item.id}`}>
                        <TableCell className="font-medium">
                          <InlineText
                            value={item.name}
                            onSave={(v) => handleInlineSave(item.id, "name", v)}
                          />
                          {contactMatchMap.has(item.id) && (
                            <div className="flex flex-wrap gap-1 mt-0.5">
                              {contactMatchMap.get(item.id)!.slice(0, 2).map(c => (
                                <Link key={c.id} href={`/contacts/${c.id}`}>
                                  <Badge variant="outline" className="text-[9px] gap-0.5 cursor-pointer hover:bg-muted border-violet-300 dark:border-violet-700" data-testid={`lead-match-contact-${c.id}`}>
                                    <Users className="w-2.5 h-2.5 text-violet-500" />{c.name}
                                  </Badge>
                                </Link>
                              ))}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          {item.groupName && (
                            <Badge variant="secondary" className="text-xs">
                              {item.groupName}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <InlineSelect
                            value={item.status}
                            options={CRM_OPTIONS.leadStatus}
                            onSave={(v) => handleInlineSave(item.id, "status", v)}
                          />
                        </TableCell>
                        <TableCell>
                          <InlineSelect
                            value={item.leadType}
                            options={CRM_OPTIONS.leadType}
                            onSave={(v) => handleInlineSave(item.id, "leadType", v)}
                          />
                        </TableCell>
                        <TableCell>
                          <InlineText
                            value={item.assignedTo}
                            onSave={(v) => handleInlineSave(item.id, "assignedTo", v)}
                          />
                        </TableCell>
                        <TableCell>
                          <InlineText
                            value={item.source}
                            onSave={(v) => handleInlineSave(item.id, "source", v)}
                          />
                        </TableCell>
                        <TableCell>
                          <InlineText
                            value={item.email}
                            onSave={(v) => handleInlineSave(item.id, "email", v)}
                          />
                        </TableCell>
                        <TableCell>
                          <InlineText
                            value={item.phone}
                            onSave={(v) => handleInlineSave(item.id, "phone", v)}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {item.status !== "Converted" && !contactMatchMap.has(item.id) && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => convertMutation.mutate(item.id)}
                                disabled={convertMutation.isPending}
                                title="Convert to CRM Contact"
                                data-testid={`button-convert-lead-${item.id}`}
                              >
                                <ArrowRightCircle className="w-3.5 h-3.5 text-emerald-600" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setEditItem(item)}
                              data-testid={`button-edit-lead-${item.id}`}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setDeleteItem(item)}
                              data-testid={`button-delete-lead-${item.id}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
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

      <LeadFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={(data) => createMutation.mutate(data)}
        isPending={createMutation.isPending}
        title="Create Lead"
        groups={groups}
      />

      {editItem && (
        <LeadFormDialog
          open={!!editItem}
          onOpenChange={(open) => { if (!open) setEditItem(null); }}
          onSubmit={(data) => updateMutation.mutate({ id: editItem.id, data })}
          isPending={updateMutation.isPending}
          title="Edit Lead"
          defaultValues={editItem}
          groups={groups}
        />
      )}

      <Dialog open={!!deleteItem} onOpenChange={(open) => { if (!open) setDeleteItem(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Lead</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{deleteItem?.name}"? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteItem(null)} data-testid="button-cancel-delete-lead">Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteItem && deleteMutation.mutate(deleteItem.id)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete-lead"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LeadFormDialog({
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
  defaultValues?: Partial<CrmLead>;
  groups: string[];
}) {
  const [form, setForm] = useState({
    name: defaultValues?.name || "",
    groupName: defaultValues?.groupName || "",
    status: defaultValues?.status || "",
    leadType: defaultValues?.leadType || "",
    assignedTo: defaultValues?.assignedTo || "",
    source: defaultValues?.source || "",
    email: defaultValues?.email || "",
    phone: defaultValues?.phone || "",
    notes: defaultValues?.notes || "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(form);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
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
              data-testid="input-lead-name"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Group</Label>
              <Input
                value={form.groupName}
                onChange={(e) => setForm({ ...form, groupName: e.target.value })}
                data-testid="input-lead-group"
              />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Input
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                data-testid="input-lead-status"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Lead Type</Label>
              <Input
                value={form.leadType}
                onChange={(e) => setForm({ ...form, leadType: e.target.value })}
                data-testid="input-lead-type"
              />
            </div>
            <div className="space-y-2">
              <Label>Assigned To</Label>
              <Input
                value={form.assignedTo}
                onChange={(e) => setForm({ ...form, assignedTo: e.target.value })}
                data-testid="input-lead-assigned"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Source</Label>
              <Input
                value={form.source}
                onChange={(e) => setForm({ ...form, source: e.target.value })}
                data-testid="input-lead-source"
              />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                data-testid="input-lead-email"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Phone</Label>
            <Input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              data-testid="input-lead-phone"
            />
          </div>
          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              data-testid="input-lead-notes"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending || !form.name} data-testid="button-submit-lead">
              {isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
