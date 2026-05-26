// Card editor — single component that switches on card.type to render
// the right form. Every card edit mutation goes through one PATCH
// endpoint so the editor doesn't need a per-type backend.
//
// Image cards use a lightweight Image Studio picker (search → select).
// Heavier types (full-fat data table builder, model file picker) can
// land as follow-ups — the shapes are forwards-compatible because
// content is jsonb.

import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from "@/components/ui/sheet";
import { Plus, Trash2, Search, X } from "lucide-react";

interface DeckCard {
  id: string;
  deck_id: string;
  type: string;
  title: string | null;
  content: any;
  state: "draft" | "locked";
}

export function CardEditorSheet({
  deckId, card, open, onOpenChange,
}: {
  deckId: string;
  card: DeckCard | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState<any>({});

  useEffect(() => {
    if (card) {
      setTitle(card.title || "");
      setContent(card.content || {});
    }
  }, [card]);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!card) return;
      const res = await apiRequest("PATCH", `/api/decks/${deckId}/cards/${card.id}`, {
        title: title || null,
        content,
      });
      if (!res.ok) throw new Error("Save failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Card saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/decks", deckId] });
      onOpenChange(false);
    },
    onError: (e: any) => toast({ title: "Save failed", description: e?.message, variant: "destructive" }),
  });

  if (!card) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            Edit card
            <Badge variant="outline" className="text-[10px]">{card.type}</Badge>
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-4 mt-4">
          <div>
            <Label className="text-xs">Title</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder={card.type} />
          </div>

          <CardTypeEditor type={card.type} content={content} onChange={setContent} />
        </div>

        <SheetFooter className="mt-6">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
            {saveMut.isPending ? "Saving…" : "Save card"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// Dispatch — render the right inputs for the card type.
function CardTypeEditor({
  type, content, onChange,
}: {
  type: string;
  content: any;
  onChange: (v: any) => void;
}) {
  switch (type) {
    case "cover":
      return <CoverEditor content={content} onChange={onChange} />;
    case "narrative":
      return <NarrativeEditor content={content} onChange={onChange} />;
    case "image":
      return <ImageEditor content={content} onChange={onChange} />;
    case "image_grid":
      return <ImageGridEditor content={content} onChange={onChange} />;
    case "map":
      return <MapEditor content={content} onChange={onChange} />;
    case "kpi_block":
      return <KpiEditor content={content} onChange={onChange} />;
    case "data_table":
      return <DataTableEditor content={content} onChange={onChange} />;
    case "model_link":
      return <ModelLinkEditor content={content} onChange={onChange} />;
    case "risk_register":
      return <RiskRegisterEditor content={content} onChange={onChange} />;
    case "next_steps":
      return <NextStepsEditor content={content} onChange={onChange} />;
    case "signature_block":
      return <SignatureBlockEditor content={content} onChange={onChange} />;
    default:
      return <GenericJsonEditor content={content} onChange={onChange} />;
  }
}

// ─── Per-type editors ──────────────────────────────────────────────────

function CoverEditor({ content, onChange }: { content: any; onChange: (v: any) => void }) {
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Subtitle</Label>
        <Input value={content?.subtitle || ""} onChange={e => onChange({ ...content, subtitle: e.target.value })}
          placeholder="e.g. AM/IM pitch — May 2026" />
      </div>
      <div>
        <Label className="text-xs">Hero line</Label>
        <Input value={content?.hero || ""} onChange={e => onChange({ ...content, hero: e.target.value })}
          placeholder="One punchy line. The pitch in 8 words." />
      </div>
    </div>
  );
}

function NarrativeEditor({ content, onChange }: { content: any; onChange: (v: any) => void }) {
  return (
    <div>
      <Label className="text-xs">Markdown</Label>
      <Textarea
        rows={14}
        value={content?.markdown || ""}
        onChange={e => onChange({ ...content, markdown: e.target.value })}
        placeholder="## Header&#10;&#10;Body text. **Bold**, _italic_, lists, etc."
        className="font-mono text-sm"
      />
    </div>
  );
}

function ImageEditor({ content, onChange }: { content: any; onChange: (v: any) => void }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const selectedId = content?.imageStudioId;
  return (
    <div className="space-y-3">
      {selectedId ? (
        <div className="rounded border p-3 flex items-center gap-3 bg-muted/40">
          <img src={`/api/image-studio/${selectedId}/thumb`} alt="" className="w-16 h-16 rounded object-cover border bg-white" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground truncate">{selectedId}</p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => onChange({ ...content, imageStudioId: null })}>
            <X className="w-3 h-3" />
          </Button>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
          <Search className="w-3 h-3 mr-1" /> Pick from Image Studio
        </Button>
      )}
      <div>
        <Label className="text-xs">Caption</Label>
        <Input value={content?.caption || ""} onChange={e => onChange({ ...content, caption: e.target.value })}
          placeholder="Caption for the image (optional)" />
      </div>
      <ImageStudioPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={id => { onChange({ ...content, imageStudioId: id }); setPickerOpen(false); }}
      />
    </div>
  );
}

function ImageGridEditor({ content, onChange }: { content: any; onChange: (v: any) => void }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const ids: string[] = Array.isArray(content?.imageIds) ? content.imageIds : [];
  const setIds = (next: string[]) => onChange({ ...content, imageIds: next });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {ids.map(id => (
          <div key={id} className="relative aspect-square rounded border overflow-hidden bg-muted">
            <img src={`/api/image-studio/${id}/thumb`} alt="" className="w-full h-full object-cover" />
            <button
              className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-1"
              onClick={() => setIds(ids.filter(x => x !== id))}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
        <button
          className="aspect-square rounded border border-dashed flex items-center justify-center text-muted-foreground hover:bg-muted/50"
          onClick={() => setPickerOpen(true)}
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground">{ids.length} image{ids.length === 1 ? "" : "s"}</p>
      <ImageStudioPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={id => { if (!ids.includes(id)) setIds([...ids, id]); }}
      />
    </div>
  );
}

function MapEditor({ content, onChange }: { content: any; onChange: (v: any) => void }) {
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Property id (optional)</Label>
        <Input value={content?.propertyId || ""} onChange={e => onChange({ ...content, propertyId: e.target.value || null })}
          placeholder="crm_properties.id — leave blank for the deck's anchor property" />
      </div>
      <div>
        <Label className="text-xs">Zoom</Label>
        <Input value={content?.zoom || ""} onChange={e => onChange({ ...content, zoom: e.target.value })}
          placeholder="default | close | wide" />
      </div>
    </div>
  );
}

function KpiEditor({ content, onChange }: { content: any; onChange: (v: any) => void }) {
  const kpis: Array<{ label?: string; value?: string; note?: string }> = Array.isArray(content?.kpis) ? content.kpis : [];
  const set = (i: number, patch: any) => {
    const next = [...kpis];
    next[i] = { ...next[i], ...patch };
    onChange({ ...content, kpis: next });
  };
  return (
    <div className="space-y-3">
      {kpis.map((k, i) => (
        <div key={i} className="grid grid-cols-12 gap-2 items-end">
          <div className="col-span-3">
            <Label className="text-xs">Value</Label>
            <Input value={k.value || ""} onChange={e => set(i, { value: e.target.value })} placeholder="£99m" />
          </div>
          <div className="col-span-4">
            <Label className="text-xs">Label</Label>
            <Input value={k.label || ""} onChange={e => set(i, { label: e.target.value })} placeholder="Exit value" />
          </div>
          <div className="col-span-4">
            <Label className="text-xs">Note</Label>
            <Input value={k.note || ""} onChange={e => set(i, { note: e.target.value })} placeholder="base case" />
          </div>
          <Button size="sm" variant="ghost" onClick={() => onChange({ ...content, kpis: kpis.filter((_, j) => j !== i) })}>
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      ))}
      <Button size="sm" variant="outline" onClick={() => onChange({ ...content, kpis: [...kpis, { value: "", label: "", note: "" }] })}>
        <Plus className="w-3 h-3 mr-1" /> Add KPI
      </Button>
    </div>
  );
}

function DataTableEditor({ content, onChange }: { content: any; onChange: (v: any) => void }) {
  const headers: string[] = Array.isArray(content?.headers) ? content.headers : [];
  const rows: string[][] = Array.isArray(content?.rows) ? content.rows : [];
  const setHeaderAt = (i: number, v: string) => {
    const next = [...headers];
    next[i] = v;
    onChange({ ...content, headers: next });
  };
  const setCell = (r: number, c: number, v: string) => {
    const next = rows.map(row => [...row]);
    while (next[r].length < headers.length) next[r].push("");
    next[r][c] = v;
    onChange({ ...content, rows: next });
  };
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Headers</Label>
        <div className="flex flex-wrap gap-2">
          {headers.map((h, i) => (
            <Input key={i} className="max-w-[160px]" value={h} onChange={e => setHeaderAt(i, e.target.value)} />
          ))}
          <Button size="sm" variant="outline" onClick={() => onChange({ ...content, headers: [...headers, ""] })}>
            <Plus className="w-3 h-3 mr-1" /> Column
          </Button>
        </div>
      </div>
      <div>
        <Label className="text-xs">Rows</Label>
        <div className="space-y-2">
          {rows.map((row, r) => (
            <div key={r} className="flex gap-2 items-center">
              {headers.map((_, c) => (
                <Input key={c} className="text-xs" value={row[c] || ""} onChange={e => setCell(r, c, e.target.value)} />
              ))}
              <Button size="sm" variant="ghost" onClick={() => onChange({ ...content, rows: rows.filter((_, j) => j !== r) })}>
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => onChange({ ...content, rows: [...rows, headers.map(() => "")] })}>
            <Plus className="w-3 h-3 mr-1" /> Row
          </Button>
        </div>
      </div>
    </div>
  );
}

function ModelLinkEditor({ content, onChange }: { content: any; onChange: (v: any) => void }) {
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Model reference</Label>
        <Input value={content?.modelRef || ""} onChange={e => onChange({ ...content, modelRef: e.target.value })}
          placeholder="Excel filename, Model Studio version, or SharePoint URL" />
      </div>
      <div>
        <Label className="text-xs">Summary</Label>
        <Textarea rows={4} value={content?.summary || ""} onChange={e => onChange({ ...content, summary: e.target.value })}
          placeholder="Headline numbers — IRR, MOIC, exit, capex — the designer renders these as a card." />
      </div>
    </div>
  );
}

function RiskRegisterEditor({ content, onChange }: { content: any; onChange: (v: any) => void }) {
  const items: Array<{ risk?: string; mitigant?: string; severity?: string }> = Array.isArray(content?.items) ? content.items : [];
  const set = (i: number, patch: any) => {
    const next = [...items];
    next[i] = { ...next[i], ...patch };
    onChange({ ...content, items: next });
  };
  return (
    <div className="space-y-3">
      {items.map((it, i) => (
        <div key={i} className="grid grid-cols-12 gap-2 items-end">
          <div className="col-span-5">
            <Label className="text-xs">Risk</Label>
            <Input value={it.risk || ""} onChange={e => set(i, { risk: e.target.value })} />
          </div>
          <div className="col-span-5">
            <Label className="text-xs">Mitigant</Label>
            <Input value={it.mitigant || ""} onChange={e => set(i, { mitigant: e.target.value })} />
          </div>
          <div className="col-span-1">
            <Label className="text-xs">Sev</Label>
            <Input value={it.severity || ""} onChange={e => set(i, { severity: e.target.value })} placeholder="L/M/H" />
          </div>
          <Button size="sm" variant="ghost" onClick={() => onChange({ ...content, items: items.filter((_, j) => j !== i) })}>
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      ))}
      <Button size="sm" variant="outline" onClick={() => onChange({ ...content, items: [...items, { risk: "", mitigant: "", severity: "" }] })}>
        <Plus className="w-3 h-3 mr-1" /> Risk
      </Button>
    </div>
  );
}

function NextStepsEditor({ content, onChange }: { content: any; onChange: (v: any) => void }) {
  const items: Array<{ action?: string; owner?: string; by?: string }> = Array.isArray(content?.items)
    ? content.items.map((x: any) => typeof x === "string" ? { action: x } : x) : [];
  const set = (i: number, patch: any) => {
    const next = [...items];
    next[i] = { ...next[i], ...patch };
    onChange({ ...content, items: next });
  };
  return (
    <div className="space-y-3">
      {items.map((it, i) => (
        <div key={i} className="grid grid-cols-12 gap-2 items-end">
          <div className="col-span-6">
            <Label className="text-xs">Action</Label>
            <Input value={it.action || ""} onChange={e => set(i, { action: e.target.value })} />
          </div>
          <div className="col-span-3">
            <Label className="text-xs">Owner</Label>
            <Input value={it.owner || ""} onChange={e => set(i, { owner: e.target.value })} />
          </div>
          <div className="col-span-3">
            <Label className="text-xs">By</Label>
            <Input value={it.by || ""} onChange={e => set(i, { by: e.target.value })} placeholder="end of week" />
          </div>
          <Button size="sm" variant="ghost" onClick={() => onChange({ ...content, items: items.filter((_, j) => j !== i) })}>
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      ))}
      <Button size="sm" variant="outline" onClick={() => onChange({ ...content, items: [...items, { action: "", owner: "", by: "" }] })}>
        <Plus className="w-3 h-3 mr-1" /> Action
      </Button>
    </div>
  );
}

function SignatureBlockEditor({ content, onChange }: { content: any; onChange: (v: any) => void }) {
  const team: Array<{ name?: string; role?: string; email?: string }> = Array.isArray(content?.team)
    ? content.team.map((x: any) => typeof x === "string" ? { name: x } : x) : [];
  const set = (i: number, patch: any) => {
    const next = [...team];
    next[i] = { ...next[i], ...patch };
    onChange({ ...content, team: next });
  };
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Fee structure</Label>
        <Textarea rows={3} value={content?.fee || ""} onChange={e => onChange({ ...content, fee: e.target.value })}
          placeholder="e.g. Monthly retainer £15k + 1% of value uplift above £80m." />
      </div>
      <div>
        <Label className="text-xs">Team</Label>
        <div className="space-y-2">
          {team.map((m, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-4">
                <Input value={m.name || ""} onChange={e => set(i, { name: e.target.value })} placeholder="Name" />
              </div>
              <div className="col-span-4">
                <Input value={m.role || ""} onChange={e => set(i, { role: e.target.value })} placeholder="Role" />
              </div>
              <div className="col-span-3">
                <Input value={m.email || ""} onChange={e => set(i, { email: e.target.value })} placeholder="Email" />
              </div>
              <Button size="sm" variant="ghost" onClick={() => onChange({ ...content, team: team.filter((_, j) => j !== i) })}>
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => onChange({ ...content, team: [...team, { name: "", role: "", email: "" }] })}>
            <Plus className="w-3 h-3 mr-1" /> Team member
          </Button>
        </div>
      </div>
    </div>
  );
}

function GenericJsonEditor({ content, onChange }: { content: any; onChange: (v: any) => void }) {
  const [text, setText] = useState(JSON.stringify(content || {}, null, 2));
  return (
    <div>
      <Label className="text-xs">Raw JSON (unknown card type)</Label>
      <Textarea rows={10} value={text} onChange={e => {
        setText(e.target.value);
        try { onChange(JSON.parse(e.target.value)); } catch { /* allow invalid while editing */ }
      }} className="font-mono text-xs" />
    </div>
  );
}

// ─── Image Studio picker ───────────────────────────────────────────────

function ImageStudioPicker({
  open, onOpenChange, onPick,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPick: (imageStudioId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const { data: images = [] } = useQuery<any[]>({
    queryKey: ["/api/image-studio/search", search],
    queryFn: async () => {
      if (!search.trim()) return [];
      const res = await apiRequest("GET", `/api/image-studio/search?q=${encodeURIComponent(search.trim())}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: open && search.trim().length >= 2,
  });
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Pick an image</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-3">
          <Input
            autoFocus
            placeholder="Search Image Studio…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search.trim().length < 2 ? (
            <p className="text-xs text-muted-foreground">Type at least 2 characters to search.</p>
          ) : !images.length ? (
            <p className="text-xs text-muted-foreground">No matches.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {images.map((img: any) => (
                <button
                  key={img.id}
                  className="aspect-square rounded border overflow-hidden bg-muted hover:ring-2 hover:ring-primary"
                  onClick={() => onPick(img.id)}
                  title={img.fileName}
                >
                  {img.thumbnailData ? (
                    <img src={img.thumbnailData} alt={img.fileName} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground p-2 text-center">
                      {img.fileName}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
