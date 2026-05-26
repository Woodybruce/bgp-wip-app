// Decks — list view. Phase 1 of the app-wide composable document
// primitive. The editor (per-card UI) lives on /decks/:id. This page is
// the landing pad: list all decks, filter by template / status, create
// a new deck from a template.

import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Layers, Plus, ChevronRight, Lock, FileText } from "lucide-react";

interface DeckRow {
  id: string;
  name: string;
  template_key: string;
  template_name: string;
  template_pdf_scope: string;
  status: string;
  property_id: string | null;
  company_id: string | null;
  deal_id: string | null;
  notes: string | null;
  card_count: number;
  locked_count: number;
  updated_at: string;
  created_at: string;
}

interface DeckTemplate {
  key: string;
  name: string;
  description: string | null;
  pdf_scope: string;
}

export default function DecksPage() {
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data: decks = [], isLoading } = useQuery<DeckRow[]>({
    queryKey: ["/api/decks"],
  });
  const { data: templates = [] } = useQuery<DeckTemplate[]>({
    queryKey: ["/api/deck-templates"],
  });

  const filtered = decks.filter(d => {
    if (statusFilter !== "all" && d.status !== statusFilter) return false;
    if (search.trim() && !d.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1400px] mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Layers className="w-6 h-6 text-primary" />
            Decks
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Composable BGP documents — Why Buy memos, AM/IM pitches, leasing brochures, rent reviews.
            One primitive, edited the same way regardless of doc type.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} data-testid="button-new-deck">
          <Plus className="w-4 h-4 mr-1" /> New deck
        </Button>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <Input
          placeholder="Search decks…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="max-w-xs h-9"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40 h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="ready">Ready</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground ml-auto">
          {filtered.length} {filtered.length === 1 ? "deck" : "decks"}
        </p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-lg" />
          ))}
        </div>
      ) : !filtered.length ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <FileText className="w-10 h-10 mx-auto mb-2 opacity-20" />
            <p className="text-sm">No decks yet</p>
            <p className="text-xs mt-1">
              Start one from a template, or have Pathway / ChatBGP populate one for you.
            </p>
            <Button size="sm" variant="outline" className="mt-4" onClick={() => setCreateOpen(true)}>
              <Plus className="w-3 h-3 mr-1" /> Create your first deck
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(d => {
            const lockedPct = d.card_count > 0 ? Math.round((d.locked_count / d.card_count) * 100) : 0;
            return (
              <Link key={d.id} href={`/decks/${d.id}`}>
                <Card className="cursor-pointer hover:bg-muted/40 transition-colors h-full">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-sm font-semibold truncate">{d.name}</CardTitle>
                      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge variant="outline" className="text-[10px]">{d.template_name || d.template_key}</Badge>
                      <Badge variant={d.status === "ready" ? "default" : "secondary"} className="text-[10px]">
                        {d.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 pt-1 space-y-2">
                    {d.notes && (
                      <p className="text-xs text-muted-foreground line-clamp-2">{d.notes}</p>
                    )}
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Lock className="w-3 h-3" />
                        {d.locked_count}/{d.card_count} locked
                      </span>
                      <span>Updated {new Date(d.updated_at).toLocaleDateString("en-GB")}</span>
                    </div>
                    <div className="h-1 bg-muted rounded overflow-hidden">
                      <div className="h-full bg-emerald-500" style={{ width: `${lockedPct}%` }} />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      <NewDeckDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        templates={templates}
        onCreated={(id) => {
          setCreateOpen(false);
          queryClient.invalidateQueries({ queryKey: ["/api/decks"] });
          // Optimistic navigation — the detail page handles the loading state.
          window.location.href = `/decks/${id}`;
        }}
        onError={(msg) => toast({ title: "Couldn't create deck", description: msg, variant: "destructive" })}
      />
    </div>
  );
}

function NewDeckDialog({
  open, onOpenChange, templates, onCreated, onError,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  templates: DeckTemplate[];
  onCreated: (id: string) => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState("");
  const [templateKey, setTemplateKey] = useState<string>(templates[0]?.key || "");
  const [notes, setNotes] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/decks", {
        name: name.trim(),
        templateKey,
        notes: notes.trim() || undefined,
      });
      return res.json();
    },
    onSuccess: (result) => {
      setName(""); setNotes("");
      onCreated(result.deck.id);
    },
    onError: (err: any) => onError(err?.message || "Unknown error"),
  });

  const activeTemplate = templates.find(t => t.key === templateKey) || templates[0];
  const finalTemplateKey = templateKey || activeTemplate?.key;
  const canSubmit = name.trim().length >= 2 && !!finalTemplateKey && !create.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New deck</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Name</label>
            <Input
              placeholder="e.g. Brixton Market Quarter — AM/IM"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Template</label>
            <Select value={finalTemplateKey} onValueChange={setTemplateKey}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {templates.map(t => (
                  <SelectItem key={t.key} value={t.key}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {activeTemplate?.description && (
              <p className="text-[11px] text-muted-foreground mt-1">{activeTemplate.description}</p>
            )}
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Notes (optional)</label>
            <Input
              placeholder="One-line brief…"
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => create.mutate()} disabled={!canSubmit}>
            {create.isPending ? "Creating…" : "Create deck"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
