// Per-receipt editor used from the approvals inbox. Covers the four things
// Wendy/Layla need on the initial pass:
//   1. change the category (Xero nominal)
//   2. see the VAT that was paid + toggle whether it's reclaimable (off folds
//      the VAT into the cost, e.g. entertainment)
//   3. allocate the cost to a person (Layla books Victoria's flight)
//   4. split one receipt across several categories / people / VAT treatments
//      (a hotel bill = accommodation + subsistence + entertainment)
import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Trash2, SplitSquareHorizontal } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface NominalCode { code: string; name: string; vatReclaimable?: boolean; vatRatePct?: number; taxType?: string; }
interface AppUser { id: string; name: string; email?: string | null; isActive?: boolean | null; }

export interface EditableExpense {
  id: string;
  merchant: string | null;
  amountPence: number;
  category: string | null;
  vatPence?: number | null;
  vatRate?: number | null;
  vatReclaimable?: boolean | null;
  allocatedToUserId?: string | null;
  businessPurpose?: string | null;
}

interface SplitLine {
  amountPounds: string;
  category: string;
  vatReclaimable: boolean | null;
  allocatedToUserId: string | null;
  businessPurpose: string;
}

const NONE = "__none__";
const fmt = (p: number) => `£${(p / 100).toFixed(2)}`;
const toPence = (pounds: string) => Math.round((parseFloat(pounds) || 0) * 100);

export default function ExpenseEditDialog({ expense, open, onClose, onSaved }: {
  expense: EditableExpense | null;
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { toast } = useToast();
  const { data: nominalCodes = [] } = useQuery<NominalCode[]>({ queryKey: ["/api/expenses/nominal-codes"] });
  const { data: users = [] } = useQuery<AppUser[]>({ queryKey: ["/api/users"] });
  const { data: existingSplits = [] } = useQuery<any[]>({
    queryKey: ["/api/expenses", expense?.id, "splits"],
    queryFn: async () => {
      const r = await apiRequest("GET", `/api/expenses/${expense!.id}/splits`, undefined);
      return r.json();
    },
    enabled: open && !!expense?.id,
  });

  const [category, setCategory] = useState("");
  const [vatReclaimable, setVatReclaimable] = useState<boolean | null>(null);
  const [allocatedToUserId, setAllocatedToUserId] = useState<string | null>(null);
  const [splitMode, setSplitMode] = useState(false);
  const [lines, setLines] = useState<SplitLine[]>([]);

  const activeUsers = useMemo(
    () => [...users].filter(u => u.isActive !== false).sort((a, b) => (a.name || "").localeCompare(b.name || "")),
    [users],
  );
  const catByName = useMemo(() => new Map(nominalCodes.map(c => [c.name, c])), [nominalCodes]);

  useEffect(() => {
    if (!open || !expense) return;
    setCategory(expense.category || "");
    setVatReclaimable(expense.vatReclaimable ?? null);
    setAllocatedToUserId(expense.allocatedToUserId ?? null);
    if (existingSplits.length > 0) {
      setSplitMode(true);
      setLines(existingSplits.map((s) => ({
        amountPounds: (s.amountPence / 100).toFixed(2),
        category: s.category || "",
        vatReclaimable: s.vatReclaimable ?? null,
        allocatedToUserId: s.allocatedToUserId ?? null,
        businessPurpose: s.businessPurpose || "",
      })));
    } else {
      setSplitMode(false);
      setLines([]);
    }
  }, [open, expense, existingSplits]);

  if (!expense) return null;

  const categoryDefaultReclaimable = catByName.get(category)?.vatReclaimable ?? true;
  const effectiveReclaimable = vatReclaimable ?? categoryDefaultReclaimable;

  const splitSum = lines.reduce((a, l) => a + toPence(l.amountPounds), 0);
  const splitBalanced = splitSum === expense.amountPence;

  const userName = (id: string | null) => activeUsers.find(u => u.id === id)?.name || "";

  const enterSplit = () => {
    setSplitMode(true);
    if (lines.length === 0) {
      setLines([{
        amountPounds: (expense.amountPence / 100).toFixed(2),
        category: category || "",
        vatReclaimable: null,
        allocatedToUserId: allocatedToUserId,
        businessPurpose: "",
      }]);
    }
  };
  const addLine = () => setLines(ls => [...ls, { amountPounds: "0.00", category: "", vatReclaimable: null, allocatedToUserId: null, businessPurpose: "" }]);
  const updateLine = (i: number, patch: Partial<SplitLine>) => setLines(ls => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  const removeLine = (i: number) => setLines(ls => ls.filter((_, idx) => idx !== i));

  const save = useMutation({
    mutationFn: async () => {
      if (splitMode) {
        if (lines.length === 0) throw new Error("Add at least one split line, or turn splitting off.");
        if (!splitBalanced) throw new Error(`Splits add to ${fmt(splitSum)} but the receipt total is ${fmt(expense.amountPence)}.`);
        const splits = lines.map((l) => ({
          amountPence: toPence(l.amountPounds),
          category: l.category || null,
          vatReclaimable: l.vatReclaimable,
          allocatedToUserId: l.allocatedToUserId,
          businessPurpose: l.businessPurpose || null,
        }));
        await apiRequest("PUT", `/api/expenses/${expense.id}/splits`, { splits });
      } else {
        // Clear any existing splits so the expense posts as a single line.
        await apiRequest("PUT", `/api/expenses/${expense.id}/splits`, { splits: [] });
      }
      await apiRequest("PATCH", `/api/expenses/${expense.id}`, {
        category: category || null,
        vatReclaimable,
        allocatedToUserId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/expenses/pending-approval"] });
      queryClient.invalidateQueries({ queryKey: ["/api/expenses/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/expenses", expense.id, "splits"] });
      toast({ title: "Saved" });
      onSaved?.();
      onClose();
    },
    onError: (e: any) => toast({ title: "Save failed", description: e?.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">
            {expense.merchant || "Expense"} · {fmt(expense.amountPence)}
          </DialogTitle>
        </DialogHeader>

        {/* VAT read off the receipt — informational. */}
        <div className="rounded-lg bg-muted/40 px-3 py-2 text-sm">
          <span className="text-muted-foreground">VAT on receipt: </span>
          {expense.vatPence != null
            ? <span className="font-medium">{fmt(expense.vatPence)}{expense.vatRate != null ? ` (${expense.vatRate}%)` : ""}</span>
            : <span className="text-muted-foreground">not detected — check the receipt photo</span>}
        </div>

        {/* Split toggle */}
        <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
          <div className="flex items-center gap-2">
            <SplitSquareHorizontal className="w-4 h-4 text-muted-foreground" />
            <div>
              <div className="text-sm font-medium">Split this receipt</div>
              <div className="text-[11px] text-muted-foreground">One bill across several categories / people (e.g. a hotel stay)</div>
            </div>
          </div>
          <Switch
            checked={splitMode}
            onCheckedChange={(v) => { if (v) enterSplit(); else setSplitMode(false); }}
            data-testid="switch-split"
          />
        </div>

        {!splitMode ? (
          <div className="space-y-4">
            {/* Category */}
            <div>
              <Label className="text-xs">Category (Xero nominal)</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger data-testid="select-category"><SelectValue placeholder="Pick a category…" /></SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  {nominalCodes.map((c) => (
                    <SelectItem key={c.code} value={c.name}>
                      {c.name}{c.vatReclaimable === false ? " · VAT not reclaimable" : c.vatRatePct ? ` · VAT ${c.vatRatePct}%` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Reclaim VAT toggle */}
            <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
              <div>
                <div className="text-sm font-medium">Reclaim the VAT</div>
                <div className="text-[11px] text-muted-foreground">
                  {effectiveReclaimable ? "VAT reclaimed from HMRC" : "VAT treated as part of the cost"}
                  {vatReclaimable == null && category ? ` · default for ${category}` : ""}
                </div>
              </div>
              <Switch checked={effectiveReclaimable} onCheckedChange={(v) => setVatReclaimable(v)} data-testid="switch-vat-reclaim" />
            </div>

            {/* Allocate to person */}
            <div>
              <Label className="text-xs">Allocate cost to</Label>
              <Select value={allocatedToUserId ?? NONE} onValueChange={(v) => setAllocatedToUserId(v === NONE ? null : v)}>
                <SelectTrigger data-testid="select-allocate"><SelectValue placeholder="The cardholder who paid" /></SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  <SelectItem value={NONE}>The cardholder who paid</SelectItem>
                  {activeUsers.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground mt-1">Use when someone booked this for another person (drives the Xero Team Member tag).</p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {lines.map((l, i) => (
              <div key={i} className="rounded-lg border p-3 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Line {i + 1}</span>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-600" onClick={() => removeLine(i)} data-testid={`button-remove-line-${i}`}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[11px]">Amount (£)</Label>
                    <Input
                      type="number" step="0.01" inputMode="decimal"
                      value={l.amountPounds}
                      onChange={(e) => updateLine(i, { amountPounds: e.target.value })}
                      data-testid={`input-line-amount-${i}`}
                    />
                  </div>
                  <div>
                    <Label className="text-[11px]">Category</Label>
                    <Select value={l.category} onValueChange={(v) => updateLine(i, { category: v })}>
                      <SelectTrigger data-testid={`select-line-category-${i}`}><SelectValue placeholder="Category…" /></SelectTrigger>
                      <SelectContent className="max-h-[260px]">
                        {nominalCodes.map((c) => <SelectItem key={c.code} value={c.name}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 items-end">
                  <div>
                    <Label className="text-[11px]">Allocate to</Label>
                    <Select value={l.allocatedToUserId ?? NONE} onValueChange={(v) => updateLine(i, { allocatedToUserId: v === NONE ? null : v })}>
                      <SelectTrigger data-testid={`select-line-allocate-${i}`}><SelectValue placeholder="Cardholder" /></SelectTrigger>
                      <SelectContent className="max-h-[260px]">
                        <SelectItem value={NONE}>The cardholder</SelectItem>
                        {activeUsers.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <label className="flex items-center justify-between rounded-md border px-2.5 py-2 h-9">
                    <span className="text-[11px]">Reclaim VAT</span>
                    <Switch
                      checked={l.vatReclaimable ?? (catByName.get(l.category)?.vatReclaimable ?? true)}
                      onCheckedChange={(v) => updateLine(i, { vatReclaimable: v })}
                      data-testid={`switch-line-vat-${i}`}
                    />
                  </label>
                </div>
                <Input
                  placeholder="What was this part for? (optional)"
                  value={l.businessPurpose}
                  onChange={(e) => updateLine(i, { businessPurpose: e.target.value })}
                  data-testid={`input-line-purpose-${i}`}
                />
              </div>
            ))}

            <div className="flex items-center justify-between">
              <Button size="sm" variant="outline" onClick={addLine} data-testid="button-add-line">
                <Plus className="w-3.5 h-3.5 mr-1" /> Add line
              </Button>
              <div className={`text-sm font-medium ${splitBalanced ? "text-emerald-600" : "text-red-600"}`}>
                {fmt(splitSum)} / {fmt(expense.amountPence)}
                {!splitBalanced && <span className="text-[11px] font-normal"> · must match the total</span>}
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => save.mutate()}
            disabled={save.isPending || (splitMode && !splitBalanced)}
            data-testid="button-save-expense-edit"
          >
            {save.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
