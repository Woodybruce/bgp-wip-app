// Property-page Decks panel — lists every Deck anchored to this property
// (Pathway-seeded Why Buy memos, manually-created AM/IM decks, etc.) and
// lets the user jump into one. New-deck button creates a blank deck
// pre-anchored to the property.

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
import { Layers, Plus, ChevronRight, Lock } from "lucide-react";

interface Deck {
  id: string;
  name: string;
  template_key: string;
  template_name: string;
  status: string;
  card_count: number;
  locked_count: number;
  updated_at: string;
}

interface Template { key: string; name: string; description: string | null }

export function PropertyDecksPanel({ propertyId }: { propertyId: string }) {
  const [createOpen, setCreateOpen] = useState(false);
  const { data: decks = [], isLoading } = useQuery<Deck[]>({
    queryKey: ["/api/decks", { propertyId }],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/decks?propertyId=${encodeURIComponent(propertyId)}`);
      return res.json();
    },
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3 pt-4 px-5">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-primary" />
          <CardTitle className="text-sm font-semibold">Decks</CardTitle>
          <Badge variant="secondary" className="text-[10px]">{decks.length}</Badge>
        </div>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setCreateOpen(true)}>
          <Plus className="w-3 h-3 mr-1" /> New deck
        </Button>
      </CardHeader>
      <CardContent className="px-5 pb-4">
        {isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : !decks.length ? (
          <p className="text-xs text-muted-foreground py-4 text-center">
            No decks yet for this property. A Why Buy deck is auto-seeded when a Pathway run completes.
          </p>
        ) : (
          <div className="space-y-1.5">
            {decks.map(d => (
              <Link key={d.id} href={`/decks/${d.id}`}>
                <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors">
                  <Layers className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{d.name}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {d.template_name || d.template_key} · {d.locked_count}/{d.card_count} locked
                    </p>
                  </div>
                  <Badge variant={d.status === "ready" ? "default" : "secondary"} className="text-[9px]">{d.status}</Badge>
                  <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>

      <NewDeckForProperty
        propertyId={propertyId}
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
    </Card>
  );
}

function NewDeckForProperty({
  propertyId, open, onOpenChange,
}: {
  propertyId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { toast } = useToast();
  const { data: templates = [] } = useQuery<Template[]>({
    queryKey: ["/api/deck-templates"],
  });
  const [name, setName] = useState("");
  const [templateKey, setTemplateKey] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/decks", {
        name: name.trim(),
        templateKey: templateKey || templates[0]?.key,
        propertyId,
      });
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/decks"] });
      onOpenChange(false);
      setName("");
      window.location.href = `/decks/${result.deck.id}`;
    },
    onError: (e: any) => toast({ title: "Couldn't create deck", description: e?.message, variant: "destructive" }),
  });

  const chosen = templateKey || templates[0]?.key || "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>New deck for this property</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <Input
            placeholder="Deck name…"
            value={name}
            onChange={e => setName(e.target.value)}
            autoFocus
          />
          <Select value={chosen} onValueChange={setTemplateKey}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {templates.map(t => (
                <SelectItem key={t.key} value={t.key}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => create.mutate()}
            disabled={create.isPending || !name.trim() || !chosen}
          >
            {create.isPending ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
