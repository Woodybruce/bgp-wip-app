// Start from the AML page (Woody, 24 November 2026: "what about my add new
// transaction text box and upload files box etc here?", then "and add new
// company AML etc"). The New transaction box is the Describe the transaction
// box's look (deal-hots.tsx): type the transaction out, or drop or choose its
// heads of terms, and New Transaction opens with them read in (its own
// Create, then its Kick off AML step). Add a company is the Companies view's
// own, for KYC with no transaction. Nothing is saved from here.
import { useRef, useState } from "react";
import { FileText, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { HOTS_ACCEPT, hasFiles } from "@/components/deal-hots";

export interface AmlStart { note?: string; file?: File }

export function AmlStartBar({ onTransaction, onCompany }: { onTransaction: (start: AmlStart) => void; onCompany: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const typed = text.trim();
  const choose = () => input.current?.click();
  const start = (s: AmlStart) => { onTransaction(s); setText(""); setOpen(false); };
  return (
    <div className="flex flex-wrap items-start gap-2" data-testid="aml-start">
      <div
        className={`min-w-0 flex-1 basis-80 rounded-md border px-2.5 py-1.5 transition-colors ${dragging ? "border-primary bg-primary/5" : "border-dashed border-border"}`}
        // The box keeps its own drops, as the Describe box does: the app-wide
        // "Drop to import" neither shows nor opens over it.
        onDragEnter={e => { if (hasFiles(e)) { e.preventDefault(); e.stopPropagation(); setDragging(true); } }}
        onDragOver={e => { if (hasFiles(e)) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "copy"; setDragging(true); } }}
        onDragLeave={e => { if (hasFiles(e)) e.stopPropagation(); if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
        onDrop={e => { if (!hasFiles(e)) return; e.preventDefault(); e.stopPropagation(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) start({ file: f }); }}
        data-testid="aml-new-transaction"
      >
        <input ref={input} type="file" accept={HOTS_ACCEPT} className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (input.current) input.current.value = ""; if (f) start({ file: f }); }} data-testid="aml-new-transaction-file" />
        <div className="flex items-start gap-2">
          <Plus className="mt-2 h-4 w-4 shrink-0 text-muted-foreground" />
          <Textarea
            value={text}
            rows={open ? 3 : 1}
            onFocus={() => setOpen(true)}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && typed.length >= 10) { e.preventDefault(); start({ note: typed }); } }}
            placeholder={dragging ? "Drop the heads of terms to start the transaction" : "New transaction: describe it, or drop the heads of terms here"}
            className={`min-h-0 resize-none border-0 bg-transparent px-1 py-1.5 text-sm shadow-none focus-visible:ring-0 ${open ? "" : "h-9 overflow-hidden"}`}
            aria-label="Describe a new transaction"
            data-testid="aml-new-transaction-text"
          />
          {!open && (
            <Button type="button" size="sm" variant="outline" className="h-8 shrink-0 text-xs" onClick={choose} data-testid="aml-new-transaction-choose">
              <FileText className="mr-1 h-3.5 w-3.5" />Heads of terms
            </Button>
          )}
        </div>
        {open && (
          <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-6">
            <Button type="button" size="sm" className="h-7 text-xs" disabled={typed.length < 10} onClick={() => start({ note: typed })} data-testid="aml-new-transaction-start">
              Fill it in
            </Button>
            <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={choose}>
              <FileText className="mr-1 h-3.5 w-3.5" />Choose the heads of terms
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => { setOpen(false); setText(""); }}>
              Cancel
            </Button>
            <span className="basis-full text-[11px] text-muted-foreground">e.g. "Letting of Unit 4, Riverside Walk to Burger Brothers Ltd. Landlord is Riverside Holdings Ltd. £150k pa, 10 years"</span>
          </div>
        )}
      </div>
      <Button type="button" size="sm" variant="outline" className="h-9 shrink-0" onClick={onCompany} data-testid="aml-add-company">
        <Plus className="mr-1 h-3.5 w-3.5" />Add a company
      </Button>
    </div>
  );
}
