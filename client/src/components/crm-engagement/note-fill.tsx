// "Describe it in your own words": a note box at the top of a new CRM
// strategy, action or event that fills the form's boxes (Woody, 2026-11-15:
// "add in the AI form filling feature we built to this"). It only fills the
// form on the screen: the person reads it and saves with the form's own
// button. BGP staff only (the server refuses the read to anyone else).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { EngagementKind } from "@shared/crm-engagement";
import type { CrmNoteForm, CrmNoteReading } from "@shared/crm-note";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const EXAMPLES: Record<CrmNoteForm, Record<EngagementKind, string>> = {
  strategy: {
    landlord: "For example: Win more food and beverage leasing from Landsec and British Land. Charlotte to own. Start in January, review at the end of June. With Landsec we want the Bluewater leisure instruction.",
    brand: "For example: Get Jersey Mike's and Wingstop into our shopping centres this year. Emily to own, from January, review in June. Jersey Mike's want 1,500 sq ft units near cinemas.",
    all: "For example: Get closer to Wingstop and the agent who acts for them, Savills. Emily to own, from January, review in June. With Wingstop we want their next five sites.",
  },
  action: {
    landlord: "For example: Rupert to call Landsec about the Bluewater leisure pitch on Tuesday at 3pm.",
    brand: "For example: Emily to send Wingstop the Trinity Leeds particulars by Friday.",
    all: "For example: Rupert to call Savills about their Wingstop requirement on Tuesday at 3pm.",
  },
  event: {
    landlord: "For example: Lunch with the Landsec leasing team at The Ivy on 12 December at 1pm, Lucy hosting. To talk through next year's instructions.",
    brand: "For example: Dinner for Wingstop and Jersey Mike's at Bluewater on 20 January at 7pm, Emily hosting. To walk them round the new leisure units.",
    all: "For example: Lunch with Landsec and Savills at The Ivy on 12 December at 1pm, Lucy hosting. To talk through next year's leisure lettings.",
  },
};

const errorText = (error: any) => {
  const raw = String(error?.message || "").replace(/^\d{3}:\s*/, "");
  try { return JSON.parse(raw)?.error || raw; } catch { return raw || "The note could not be read. Fill the form in by hand."; }
};

export function CrmNoteFill({ form, kind, saveWord, onRead }: { form: CrmNoteForm; kind: EngagementKind; saveWord: string; onRead: (reading: CrmNoteReading) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reading, setReading] = useState<CrmNoteReading | null>(null);
  // A client login adds its requests through the same forms, and the reader
  // is BGP's: it is never offered a box the server would refuse.
  const { data: me } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const staff = !!me && me.role !== "Client" && !me.companyScopeId;
  const enough = text.trim().split(/\s+/).filter(Boolean).length >= 3;
  const read = async () => {
    setBusy(true); setError("");
    try {
      const result: CrmNoteReading = await (await apiRequest("POST", `/api/crm/engagement/read-note?kind=${kind}`, { form, text })).json();
      setReading(result);
      onRead(result);
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };
  if (!staff) return null;
  return (
    <section className="rounded-lg border bg-muted/20 p-3 space-y-2" data-testid="crm-note-fill">
      <label className="block space-y-1.5 text-sm">
        <span className="font-medium">Describe it in your own words</span>
        <Textarea rows={3} maxLength={4000} value={text} onChange={e => setText(e.target.value)} placeholder={EXAMPLES[form][kind]} data-testid="crm-note-text" />
      </label>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Button type="button" size="sm" variant="outline" disabled={busy || !enough} onClick={read} data-testid="crm-note-read">{busy ? "Reading…" : reading ? "Read again" : "Fill the form"}</Button>
        <span className="text-xs text-muted-foreground">Fills the boxes below from your note. Nothing is saved until you press {saveWord}.</span>
      </div>
      {error && <p role="alert" className="text-xs text-destructive break-words">{error}</p>}
      {reading && (
        <div className="text-xs space-y-0.5" data-testid="crm-note-result">
          {reading.filled.length
            ? <p><span className="font-medium">Filled:</span> <span className="text-muted-foreground">{reading.filled.join(", ")}. Check each box before you save.</span></p>
            : <p className="text-muted-foreground">Nothing in the note could be placed in a box. Fill the form in by hand.</p>}
          {reading.notFound.length > 0 && <p><span className="font-medium">Not on this list, add by hand:</span> <span className="text-muted-foreground">{reading.notFound.join(", ")}</span></p>}
          {reading.check.map((line, i) => <p key={i} className="text-muted-foreground">Check: {line}</p>)}
        </div>
      )}
    </section>
  );
}
