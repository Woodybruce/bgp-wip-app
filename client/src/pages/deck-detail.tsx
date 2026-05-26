// Deck detail — read-only Phase 1 view of a deck's cards.
// Phase 2 will replace this with the full editor (per-card editor sheets,
// drag-to-reorder, image picker, etc.). For now the list view confirms
// the schema is wired correctly and lets you lock/unlock cards as a
// proof of state transitions.

import { useParams, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Layers, ArrowLeft, Lock, Unlock, FileText, Image as ImageIcon, Map, Table2,
  Type, BarChart3, AlertTriangle, ListChecks, Users, ImagePlus, Sparkles,
} from "lucide-react";

interface DeckCard {
  id: string;
  deck_id: string;
  type: string;
  sort_order: number;
  state: "draft" | "locked";
  title: string | null;
  content: any;
  asset_refs: any;
  locked_at: string | null;
  locked_by: string | null;
  updated_at: string;
}

interface DeckData {
  deck: {
    id: string;
    name: string;
    template_key: string;
    template_name: string;
    template_pdf_scope: string;
    status: string;
    notes: string | null;
    property_id: string | null;
    company_id: string | null;
    deal_id: string | null;
    updated_at: string;
    created_at: string;
  };
  cards: DeckCard[];
}

const CARD_ICONS: Record<string, any> = {
  cover: Sparkles,
  narrative: Type,
  image: ImageIcon,
  image_grid: ImagePlus,
  map: Map,
  kpi_block: BarChart3,
  data_table: Table2,
  model_link: FileText,
  risk_register: AlertTriangle,
  next_steps: ListChecks,
  signature_block: Users,
};

export default function DeckDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();

  const { data, isLoading } = useQuery<DeckData>({
    queryKey: ["/api/decks", id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/decks/${id}`);
      return res.json();
    },
    enabled: !!id,
  });

  const lockMut = useMutation({
    mutationFn: async ({ cardId, lock }: { cardId: string; lock: boolean }) => {
      const url = `/api/decks/${id}/cards/${cardId}/${lock ? "lock" : "unlock"}`;
      const res = await apiRequest("POST", url);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/decks", id] }),
    onError: (e: any) => toast({ title: "Action failed", description: e?.message, variant: "destructive" }),
  });

  const assembleMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/decks/${id}/assemble`);
      return res.json();
    },
    onError: (e: any) => toast({ title: "Assemble", description: e?.message || "Not built yet (Phase 1.5)", variant: "destructive" }),
    onSuccess: (result) => toast({ title: "Assemble", description: result?.hint || "Coming in Phase 1.5" }),
  });

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 max-w-[1200px] mx-auto space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        Deck not found.{" "}
        <Link href="/decks" className="text-primary underline">Back to decks</Link>
      </div>
    );
  }

  const { deck, cards } = data;
  const lockedCount = cards.filter(c => c.state === "locked").length;
  const allLocked = cards.length > 0 && lockedCount === cards.length;

  return (
    <div className="p-4 md:p-6 max-w-[1200px] mx-auto space-y-6">
      <div className="flex flex-col gap-3">
        <Link href="/decks" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 w-fit">
          <ArrowLeft className="w-3 h-3" /> All decks
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Layers className="w-6 h-6 text-primary" />
              {deck.name}
            </h1>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <Badge variant="outline" className="text-[10px]">{deck.template_name || deck.template_key}</Badge>
              <Badge variant={deck.status === "ready" ? "default" : "secondary"} className="text-[10px]">{deck.status}</Badge>
              <span className="text-xs text-muted-foreground">
                {lockedCount}/{cards.length} cards locked
              </span>
            </div>
            {deck.notes && (
              <p className="text-sm text-muted-foreground mt-2 max-w-2xl">{deck.notes}</p>
            )}
          </div>
          <Button
            onClick={() => assembleMut.mutate()}
            disabled={!allLocked || assembleMut.isPending}
            title={!allLocked ? "Lock every card to assemble" : "Assemble PDF"}
          >
            <FileText className="w-4 h-4 mr-1.5" />
            Assemble PDF
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm">Cards</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 px-4 pb-4">
          {cards.length === 0 && (
            <p className="text-sm text-muted-foreground py-6 text-center">
              This deck has no cards yet.
            </p>
          )}
          {cards.map(card => {
            const Icon = CARD_ICONS[card.type] || FileText;
            const locked = card.state === "locked";
            return (
              <div
                key={card.id}
                className={`flex items-start gap-3 p-3 rounded-lg border ${
                  locked ? "bg-emerald-50/40 dark:bg-emerald-950/20 border-emerald-200/60 dark:border-emerald-900/40" : "bg-card"
                }`}
              >
                <Icon className="w-4 h-4 mt-1 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium">{card.title || card.type}</p>
                    <Badge variant="outline" className="text-[9px]">{card.type}</Badge>
                    {locked && (
                      <Badge className="text-[9px] bg-emerald-600">locked</Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Updated {new Date(card.updated_at).toLocaleString("en-GB")}
                    {locked && card.locked_by && ` · locked by ${card.locked_by}`}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant={locked ? "outline" : "default"}
                  onClick={() => lockMut.mutate({ cardId: card.id, lock: !locked })}
                  disabled={lockMut.isPending}
                  className="shrink-0 h-7 text-xs"
                >
                  {locked ? <><Unlock className="w-3 h-3 mr-1" /> Unlock</> : <><Lock className="w-3 h-3 mr-1" /> Lock</>}
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card className="border-dashed">
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground">
            <strong>Phase 1 — read-only view.</strong> Per-card editor (drag-to-reorder, content
            editing, image picker, model attach) lands in Phase 2. The assembler button is wired
            to /api/decks/:id/assemble which currently returns 501 — Phase 1.5.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
