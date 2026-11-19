// "Describe the brief in your own words" (Woody, 2026-11-19: "brief form
// needs our type and populate tool"): the person types or pastes the brief,
// or the client's email about it, and the Brief and Commercials boxes fill.
// It only fills the form on the screen: the dialog's own Save is the only
// save. The server checks every value against the note (shared/brief-note.ts)
// and lists back what it could not place.
import { useState } from "react";
import { BRIEF_NOTE_MAX, type BriefNoteReading } from "@shared/brief-note";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const EXAMPLE = "For example: Hammerson want a restaurant or leisure operator for the unit, no extract. Quoting £90k pa on a 10 year lease, up to 6 months rent free. Five targets, two of them priority A, by 5 December; meetings with the priority A operators by 19 December.";

const errorText = (error: any) => {
  const raw = String(error?.message || "").replace(/^\d{3}:\s*/, "");
  try { const body = JSON.parse(raw); return body?.message || body?.error || raw; } catch { return raw || "The note could not be read. Fill the brief in by hand."; }
};

export function BriefNoteFill({ unitId, saveWord, onRead }: { unitId: string; saveWord: string; onRead: (reading: BriefNoteReading) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reading, setReading] = useState<BriefNoteReading | null>(null);
  const enough = text.trim().split(/\s+/).filter(Boolean).length >= 3;
  const read = async () => {
    setBusy(true); setError("");
    try {
      const result: BriefNoteReading = await (await apiRequest("POST", "/api/unit-briefs/read-note", { unitId, text })).json();
      setReading(result);
      onRead(result);
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };
  return (
    <section className="rounded-lg border bg-muted/20 p-3 space-y-2" data-testid="brief-note-fill">
      <label className="block space-y-1.5 text-sm">
        <span className="font-medium">Describe the brief in your own words</span>
        <Textarea rows={3} maxLength={BRIEF_NOTE_MAX} value={text} onChange={e => setText(e.target.value)} placeholder={EXAMPLE} data-testid="brief-note-text" />
      </label>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Button type="button" size="sm" variant="outline" disabled={busy || !enough} onClick={read} data-testid="brief-note-read">{busy ? "Reading…" : reading ? "Read again" : "Fill the brief"}</Button>
        <span className="text-xs text-muted-foreground">Type it, or paste the client's email. Fills the boxes below and the commercials. Nothing is saved until you press {saveWord}.</span>
      </div>
      {error && <p role="alert" className="text-xs text-destructive break-words">{error}</p>}
      {reading && (
        <div className="text-xs space-y-0.5" data-testid="brief-note-result">
          {reading.filled.length + reading.filledCommercials.length === 0
            ? <p className="text-muted-foreground">Nothing in the note could be placed in a box. Fill the brief in by hand.</p>
            : <>
                {reading.filled.length > 0 && <p><span className="font-medium">Filled:</span> <span className="text-muted-foreground">{reading.filled.join(", ")}.</span></p>}
                {reading.filledCommercials.length > 0 && <p><span className="font-medium">Commercials:</span> <span className="text-muted-foreground">{reading.filledCommercials.join(", ")}.</span></p>}
                <p className="text-muted-foreground">Check each box before you save.</p>
              </>}
          {reading.notPlaced.length > 0 && (
            <div data-testid="brief-note-not-placed">
              <p className="font-medium">Not filled, add by hand if it is right:</p>
              <ul className="list-disc pl-4 text-muted-foreground">{reading.notPlaced.map((line, i) => <li key={i} className="break-words">{line}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
