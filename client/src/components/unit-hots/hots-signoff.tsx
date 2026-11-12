// Sign-off and history for the Heads of Terms workspace. The people who
// sign off are the people on the unit's Targeting Brief. A person agrees as
// themselves; BGP staff record an agreement only for someone with no login.
// A signature counts on the current version only.
import { useState } from "react";
import { Check, CircleAlert, CircleCheck, CircleDashed, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { briefRoleLabel } from "@shared/unit-brief";
import type { HotsEvent, HotsSigner, HotsWorkspace } from "@shared/unit-hots";
import { CHIP, MICRO_LABEL, TONE_GOOD, TONE_WARN, fmtDate, fmtWhen } from "./hots-api";

const HISTORY_SHOWN = 6;

export function HotsSignoff({ ws, open, busy, dirty, agreeIsPrimary, onAgree, onWithdraw }: {
  ws: HotsWorkspace;
  open: boolean;              // sign-off is open (a draft that is not yet issued)
  busy: string | null;
  dirty: boolean;             // the person has amendments they have not saved
  agreeIsPrimary: boolean;    // the Agree button is the one filled button on screen
  onAgree: (s: HotsSigner) => void;
  onWithdraw: (s: HotsSigner) => void;
}) {
  const { signers, approval, viewer } = ws;
  const tone = approval.complete ? `border-emerald-600/60 ${TONE_GOOD}` : approval.agreed > 0 ? `border-amber-500/60 ${TONE_WARN}` : "border-border text-muted-foreground";
  return (
    <section className="space-y-2.5 min-w-0" data-testid="hots-signoff">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Sign-off</h3>
        {signers.length > 0 && (
          <span className={`${CHIP} ${tone}`} data-testid="hots-signoff-count">
            <span className="font-mono tabular-nums">{approval.agreed}</span> of <span className="font-mono tabular-nums">{approval.total}</span> agreed
          </span>
        )}
      </div>
      {signers.length === 0 ? (
        <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground" data-testid="hots-signoff-empty">
          Nobody is listed on this unit's brief. Add the people involved on the Targeting Brief so they can sign off.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {signers.map(s => {
            const signing = busy === `agree:${s.briefPersonId}`;
            const canSign = open && (s.isMe || (viewer.isStaff && !s.userId));
            return (
              <li key={s.briefPersonId} className="space-y-1.5 p-3" data-testid={`hots-signer-${s.briefPersonId}`}>
                <div className="min-w-0">
                  <p className={MICRO_LABEL}>{briefRoleLabel(s.role)}</p>
                  <p className="text-sm font-medium break-words">
                    {s.name}
                    {s.isMe && <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">You</span>}
                  </p>
                  {s.firm && <p className="text-xs text-muted-foreground break-words">{s.firm}</p>}
                </div>
                <p className="text-xs" data-testid={`hots-signer-state-${s.briefPersonId}`}>
                  {s.agreedAt ? (
                    <span className={`inline-flex flex-wrap items-center gap-x-1 font-medium ${TONE_GOOD}`}>
                      <CircleCheck className="h-3.5 w-3.5 shrink-0" /> Agreed {fmtDate(s.agreedAt)}
                      {s.agreedOnBehalf && s.agreedByName && <span className="font-normal text-muted-foreground">· recorded by {s.agreedByName}</span>}
                    </span>
                  ) : s.staleAgreedAt ? (
                    <span className={`inline-flex items-start gap-1 font-medium ${TONE_WARN}`}>
                      <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" /> Agreed an earlier version
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <CircleDashed className="h-3.5 w-3.5 shrink-0" /> Not yet agreed
                    </span>
                  )}
                </p>
                {open && viewer.isStaff && !s.isMe && !!s.userId && !s.agreedAt && (
                  <p className="text-xs text-muted-foreground" data-testid={`hots-signer-has-login-${s.briefPersonId}`}>Has a login, agrees for themselves</p>
                )}
                {canSign && !s.agreedAt && s.isMe && (
                  <div className="space-y-1">
                    <Button type="button" size="sm" variant={agreeIsPrimary ? "default" : "outline"} disabled={!!busy || dirty} onClick={() => onAgree(s)} data-testid={`hots-agree-${s.briefPersonId}`}>
                      {signing ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />}Agree Heads of Terms
                    </Button>
                    {dirty && <p className="text-xs text-muted-foreground">Save your amendments first, then agree.</p>}
                  </div>
                )}
                {canSign && !s.agreedAt && !s.isMe && (
                  <Button type="button" size="sm" variant="outline" disabled={!!busy} onClick={() => onAgree(s)} aria-label={`Record agreement for ${s.name}`} data-testid={`hots-record-${s.briefPersonId}`}>
                    {signing && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Record agreement
                  </Button>
                )}
                {canSign && !!s.agreedAt && (
                  <Button type="button" size="sm" variant="ghost" disabled={!!busy} onClick={() => onWithdraw(s)} aria-label={s.isMe ? "Withdraw my agreement" : `Withdraw ${s.name}'s agreement`} data-testid={`hots-withdraw-${s.briefPersonId}`}>
                    {signing && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Withdraw
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {open && viewer.isStaff && signers.some(s => !s.userId) && (
        <p className="text-xs text-muted-foreground" data-testid="hots-signoff-staff-note">
          For someone without a login, record their agreement once they have confirmed it, for example by email. The record shows that you recorded it.
        </p>
      )}
    </section>
  );
}

export function HotsHistory({ events }: { events: HotsEvent[] }) {
  const [all, setAll] = useState(false);
  if (events.length === 0) return null;
  // Oldest first; a long history shows its latest lines until asked for all.
  const shown = all || events.length <= HISTORY_SHOWN ? events : events.slice(-HISTORY_SHOWN);
  return (
    <section className="space-y-2 min-w-0" data-testid="hots-history">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">History</h3>
        {events.length > HISTORY_SHOWN && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setAll(v => !v)} data-testid="hots-history-toggle">
            {all ? "Show latest" : `Show all ${events.length}`}
          </Button>
        )}
      </div>
      <ol className="space-y-2.5">
        {shown.map(e => {
          const body = (e.body || e.kind).trim();
          return (
            <li key={e.id} className="border-l-2 border-border pl-2.5" data-testid={`hots-event-${e.id}`}>
              <p className="text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">{e.authorName || "Someone"}</span>
                {e.authorRole ? ` · ${e.authorRole}` : ""} · {fmtWhen(e.createdAt)}
              </p>
              <p className="whitespace-pre-line break-words text-xs">{body.charAt(0).toUpperCase() + body.slice(1)}</p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
