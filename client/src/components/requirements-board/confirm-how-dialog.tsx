// "How do you know?" (the requirements centre, 12 November 2026): the FIRST
// confirmation of a requirement nobody at BGP has confirmed before asks how
// the person knows, so a market listing or a draft never reads as confirmed
// by a conversation nobody recorded. Still live, on a requirement a person
// has confirmed before, is one tap and needs no dialog. Used by the board and
// by the brand page's market listings (19 November 2026).
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export const CONFIRM_HOW_OPTIONS = [
  ["call", "I spoke to the brand or its agent (call)"],
  ["meeting", "I met the brand or its agent"],
  ["email", "They told me by email"],
  ["chat", "They told me by message or chat"],
  ["still_live", "No conversation: I am vouching for it myself"],
] as const;

/** `onConfirm` is given the way of knowing to send, or undefined for "no conversation". */
export function ConfirmHowDialog({ name, open, onClose, onConfirm }: {
  name: string | null;
  open: boolean;
  onClose: () => void;
  onConfirm: (how: string | undefined) => void;
}) {
  const [how, setHow] = useState("call");
  useEffect(() => { if (open) setHow("call"); }, [open]);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-confirm-how">
        <DialogHeader>
          <DialogTitle>How do you know?</DialogTitle>
          <DialogDescription>
            Nobody has confirmed {name || "this requirement"} before. You are recorded as confirming it today, with how you know.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5" role="radiogroup" aria-label="How do you know?">
          {CONFIRM_HOW_OPTIONS.map(([value, label]) => (
            <button key={value} type="button" role="radio" aria-checked={how === value} onClick={() => setHow(value)}
              className={cn("flex min-h-11 w-full items-center gap-2 rounded-md border p-2 text-left text-sm", how === value ? "border-foreground bg-muted/40" : "border-border hover:bg-muted/30")}
              data-testid={`confirm-how-${value}`}>
              <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded-full border", how === value ? "border-foreground bg-foreground text-background" : "border-border")}>
                {how === value && <Check className="h-3 w-3" />}
              </span>
              <span className="min-w-0">{label}</span>
            </button>
          ))}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} data-testid="confirm-how-cancel">Cancel</Button>
          <Button onClick={() => onConfirm(how === "still_live" ? undefined : how)} data-testid="confirm-how-submit">Confirm</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
