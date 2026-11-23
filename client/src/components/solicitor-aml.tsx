// The solicitors on a transaction, checked against the SRA register and the
// web with sources: the other side's (Woody, 21 November 2026, "do 7"; BGP's
// AML policy, counterparties) and our client's (Woody, 23 November 2026: "we
// need our clients solicitors checked at SRA too I think"). The register is
// the SRA's own data: a name that matches several entries asks which firm it
// is first. The rules are shared/solicitor-aml.ts and shared/sra-register.ts;
// the routes server/solicitor-aml.ts. BGP staff only.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ExternalLink, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { SOLICITOR_SIDES, SOLICITOR_SIDE_WORDS, sameSolicitorFirm, solicitorCheckWords, solicitorMediaCounts, type SolicitorCheck, type SolicitorSide } from "@shared/solicitor-aml";
import { SRA_ATTRIBUTION_URL, SRA_ATTRIBUTION_WORDS, SRA_REGISTER_SEARCH_URL, sraStatus, type SraChoice, type SraTone } from "@shared/sra-register";

export interface DealSolicitorsAml { dealId: string; onDeal: string | null; checks: Array<SolicitorCheck & { id: string; by: string | null; side: SolicitorSide }> }
interface ChoiceAnswer { choose: true; firm: string; candidates: SraChoice[]; more: number; readAt: string; side: SolicitorSide }
interface CheckAsk { firm: string; side: SolicitorSide; sraNumber?: string; none?: boolean }

const keyFor = (dealId: string) => ["/api/deals", dealId, "solicitors-aml"];

export function useDealSolicitorsAml(dealId: string, enabled = true) {
  return useQuery<DealSolicitorsAml>({ queryKey: keyFor(dealId), enabled: enabled && !!dealId, staleTime: 60_000 });
}

const SIDE_SHORT: Record<SolicitorSide, string> = { client: "Our client's", other: "Other side's" };

/** The section's line: where each side's solicitors stand, in a few words. */
export function solicitorsSummary(data: DealSolicitorsAml | undefined): { tone: "done" | "act" | "flag" | "info"; words: string } {
  if (!data) return { tone: "info", words: "Not read yet" };
  let tone: "done" | "act" | "flag" = "done";
  const parts = SOLICITOR_SIDES.map(side => {
    const mine = data.checks.filter(c => c.side === side);
    if (!mine.length) {
      if (tone === "done") tone = "act";
      return `${SIDE_SHORT[side]}: ${side === "client" && data.onDeal ? `${data.onDeal}, not checked` : "not checked"}`;
    }
    const lines = mine.map(solicitorCheckWords);
    if (lines.some(l => l.tone === "attention")) tone = "flag";
    else if (lines.some(l => l.tone === "info") && tone === "done") tone = "act";
    const state = lines.some(l => l.tone === "attention") ? "needs a look" : lines.some(l => l.tone === "info") ? "check it" : "regulated";
    return `${SIDE_SHORT[side]}: ${mine.length === 1 ? (mine[0].register.sra?.name || mine[0].firm) : `${mine.length} firms`}, ${state}`;
  });
  return { tone, words: parts.join(" · ") };
}

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });
const dayTime = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
const CH_BASE = "https://find-and-update.company-information.service.gov.uk/company";
const webHref = (w: string) => /^https?:\/\//i.test(w) ? w : `https://${w}`;

const TONE_CHIP: Record<SraTone, string> = {
  ok: "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900",
  info: "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900",
  attention: "bg-red-50 text-red-800 border-red-200 dark:bg-red-950/30 dark:text-red-300 dark:border-red-900",
};
function StatusChip({ label, tone }: { label: string; tone: SraTone }) {
  return <span className={`inline-flex items-center rounded-full border px-1.5 py-0 text-[11px] leading-5 ${TONE_CHIP[tone]}`}>{label}</span>;
}

function ChoiceRow({ c, onPick, busy, action }: { c: SraChoice; onPick: () => void; busy: boolean; action: string }) {
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1" data-testid={`sra-choice-${c.sraNumber}`}>
      <span className="font-medium">{c.name}</span>
      <StatusChip label={c.label} tone={c.tone} />
      <span className="text-muted-foreground">SRA {c.sraNumber}{c.place ? ` · ${c.place}` : ""}{c.offices > 1 ? ` · ${c.offices} offices` : ""}{c.alsoKnownAs ? ` · ${c.alsoKnownAs}` : ""}</span>
      <button type="button" className="text-primary underline disabled:opacity-50" disabled={busy} onClick={onPick}>{action}</button>
    </li>
  );
}

/** What the SRA's entry says about the firm: status, where, how to reach it, other names, the work it lists. */
function SraEntry({ c, onCheck, busy }: { c: SolicitorCheck; onCheck: (ask: Omit<CheckAsk, "side">) => void; busy: boolean }) {
  const reg = c.register;
  const f = reg.sra;
  if (!f) {
    return (
      <div className="space-y-1">
        <p className="text-muted-foreground">
          Look the firm up on the <a href={SRA_REGISTER_SEARCH_URL} target="_blank" rel="noreferrer" className="text-primary hover:underline">SRA's register</a>: some firms are not in the SRA's data under the name people use for them.
        </p>
        {reg.alternatives && reg.alternatives.length > 0 && (
          <div>
            <p className="text-muted-foreground">Entries with a similar name:</p>
            <ul>{reg.alternatives.map(a => <ChoiceRow key={a.sraNumber} c={a} busy={busy} action="Check this one" onPick={() => onCheck({ firm: c.firm, sraNumber: a.sraNumber })} />)}</ul>
          </div>
        )}
      </div>
    );
  }
  const st = sraStatus(f);
  const ho = f.headOffice;
  const known = [...f.tradingNames.slice(0, 3).map(n => `trading as ${n}`), ...f.previousNames.slice(0, 3).map(n => `formerly ${n}`)];
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <StatusChip label={st.label} tone={st.tone} />
        {reg.url && <a href={reg.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">SRA page <ExternalLink className="w-3 h-3" /></a>}
        {f.companyNumber && <a href={`${CH_BASE}/${f.companyNumber}`} target="_blank" rel="noreferrer" className="text-muted-foreground hover:underline">Companies House {f.companyNumber}</a>}
      </div>
      {st.explain && <p className={st.tone === "attention" ? "text-red-800 dark:text-red-300" : st.tone === "info" ? "text-amber-800 dark:text-amber-300" : "text-muted-foreground"}>{st.explain}</p>}
      {ho && (
        <p className="text-muted-foreground">
          Head office: {ho.address || "not given"}
          {ho.phone ? <> · <a href={`tel:${ho.phone.replace(/\s+/g, "")}`} className="hover:underline">{ho.phone}</a></> : null}
          {ho.email ? <> · <a href={`mailto:${ho.email}`} className="hover:underline">{ho.email}</a></> : null}
          {ho.website ? <> · <a href={webHref(ho.website)} target="_blank" rel="noreferrer" className="hover:underline">{ho.website}</a></> : null}
          {f.offices > 1 ? ` · ${f.offices} offices` : ""}
        </p>
      )}
      <p className="text-muted-foreground">Check the email address and phone number you have for them match the SRA's: fraudsters pose as real law firms.</p>
      {known.length > 0 && <p className="text-muted-foreground">Also: {known.join("; ")}</p>}
      {f.workAreas.length > 0 && <p className="text-muted-foreground">Work it lists: {f.workAreas.slice(0, 8).join(", ")}{f.workAreas.length > 8 ? ` and ${f.workAreas.length - 8} more` : ""}</p>}
      {reg.alternatives && reg.alternatives.length > 0 && (
        <details>
          <summary className="cursor-pointer text-muted-foreground">Not them? {reg.others || reg.alternatives.length} other entr{(reg.others || reg.alternatives.length) === 1 ? "y matches" : "ies match"} the name</summary>
          <ul className="pl-2">{reg.alternatives.map(a => <ChoiceRow key={a.sraNumber} c={a} busy={busy} action="Check this one instead" onPick={() => onCheck({ firm: c.firm, sraNumber: a.sraNumber })} />)}</ul>
        </details>
      )}
    </div>
  );
}

export function DealSolicitorsAmlPanel({ dealId }: { dealId: string }) {
  const { toast } = useToast();
  const { data } = useDealSolicitorsAml(dealId);
  const [firm, setFirm] = useState<Record<SolicitorSide, string>>({ client: "", other: "" });
  const [choice, setChoice] = useState<ChoiceAnswer | null>(null);
  const check = useMutation({
    mutationFn: async (ask: CheckAsk) => ({ ...(await (await apiRequest("POST", `/api/deals/${dealId}/solicitors-aml/check`, ask)).json()), side: ask.side }),
    onSuccess: (answer: any) => {
      if (answer?.choose) { setChoice(answer as ChoiceAnswer); return; }
      setChoice(null);
      setFirm(f => ({ ...f, [answer.side as SolicitorSide]: "" }));
      queryClient.invalidateQueries({ queryKey: keyFor(dealId) });
    },
    onError: (e: any) => toast({ title: "Not checked", description: String(e?.message || e).replace(/^\d+:\s*/, ""), variant: "destructive" }),
  });
  if (!data) return null;
  const run = (ask: CheckAsk) => check.mutate(ask);
  const busyFor = (name: string, side: SolicitorSide) => check.isPending && check.variables?.firm === name && check.variables?.side === side && !check.variables?.sraNumber;
  const usesSra = !!choice || data.checks.some(c => c.register.source === "sra_data");
  return (
    <div className="space-y-3 text-xs" data-testid="deal-solicitors-aml">
      <p className="text-muted-foreground">Each firm is checked against the SRA's own data on the firms it regulates. The other side's are also searched on the web for regulatory action or misconduct, as BGP's policy asks. Only what a source it read says is kept.</p>
      {choice && (
        <div className="rounded border px-2 py-1.5 space-y-1" data-testid="sra-choose">
          <p>{choice.candidates.length + choice.more} entries on the SRA's register match <span className="font-medium">{choice.firm}</span>. Which firm is acting for {choice.side === "client" ? "our client" : "the other side"}?</p>
          <ul>{choice.candidates.map(c => <ChoiceRow key={c.sraNumber} c={c} busy={check.isPending} action="This one" onPick={() => run({ firm: choice.firm, side: choice.side, sraNumber: c.sraNumber })} />)}</ul>
          {choice.more > 0 && <p className="text-muted-foreground">{choice.more} more: type more of the name, or its SRA number, to narrow it.</p>}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="underline disabled:opacity-50" disabled={check.isPending} onClick={() => run({ firm: choice.firm, side: choice.side, none: true })} data-testid="sra-choose-none">None of these</button>
            <button type="button" className="underline text-muted-foreground" disabled={check.isPending} onClick={() => setChoice(null)}>Cancel</button>
            {check.isPending && <span className="text-muted-foreground inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />Checking: about a minute.</span>}
          </div>
        </div>
      )}
      {SOLICITOR_SIDES.map(side => {
        const mine = data.checks.filter(c => c.side === side);
        // Our client's solicitors as the transaction records them, offered until they are checked.
        const onDeal = side === "client" && data.onDeal && !mine.some(c => sameSolicitorFirm(c.firm, data.onDeal)) ? data.onDeal : null;
        const typed = firm[side].trim();
        return (
          <div key={side} className="space-y-1.5" data-testid={`solicitors-${side}`}>
            <p className="font-semibold">{SOLICITOR_SIDE_WORDS[side]}</p>
            {onDeal && !choice && (
              <div className="flex flex-wrap items-center gap-2">
                <span>On the transaction: <span className="font-medium">{onDeal}</span></span>
                <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={check.isPending} onClick={() => run({ firm: onDeal, side })} data-testid="solicitors-check-on-deal">
                  {busyFor(onDeal, side) ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Search className="w-3 h-3 mr-1" />}Check them
                </Button>
              </div>
            )}
            {mine.map(c => {
              const w = solicitorCheckWords(c);
              return (
                <div key={c.id} className={`rounded border px-2 py-1.5 space-y-1 ${w.tone === "attention" ? "border-red-300 bg-red-50/60 dark:border-red-900 dark:bg-red-950/20" : ""}`} data-testid={`solicitor-check-${c.id}`}>
                  <p className={w.tone === "attention" ? "text-red-800 dark:text-red-300" : ""}>{w.words}</p>
                  {c.register.source === "sra_data"
                    ? <SraEntry c={c} onCheck={ask => run({ ...ask, side })} busy={check.isPending} />
                    : <>
                        {c.register.url && <a href={c.register.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">Register page <ExternalLink className="w-3 h-3" /></a>}
                        {c.register.office && <p className="text-muted-foreground">Office: {c.register.office}</p>}
                      </>}
                  {solicitorMediaCounts(c) && c.media.findings.length > 0 && (
                    <ul className="space-y-0.5">
                      {c.media.findings.map(f => (
                        <li key={f.url}>{f.summary}{f.unsureIdentity ? <span className="text-muted-foreground"> (may be another firm)</span> : null} · <a href={f.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">{f.source}</a>{f.date ? <span className="text-muted-foreground">, {f.date}</span> : null}</li>
                      ))}
                    </ul>
                  )}
                  {c.errors.length > 0 && <p className="text-amber-800 dark:text-amber-300">{c.errors.join(" ")}</p>}
                  <p className="text-[11px] text-muted-foreground">Checked {day(c.ranAt)}{c.by ? ` by ${c.by}` : ""}{c.register.readAt ? ` · SRA data read ${dayTime(c.register.readAt)}` : ""} ·{" "}
                    <button type="button" className="underline" disabled={check.isPending} onClick={() => run({ firm: c.firm, side, ...(c.register.sra?.sraNumber ? { sraNumber: c.register.sra.sraNumber } : {}) })}>Check again</button></p>
                </div>
              );
            })}
            <div className="flex flex-wrap items-center gap-1.5">
              <Input value={firm[side]} onChange={e => setFirm(f => ({ ...f, [side]: e.target.value }))}
                placeholder={`${mine.length ? "Another firm" : side === "client" ? "Our client's solicitors" : "The other side's solicitors"} (firm name or SRA number)`}
                className="h-8 max-w-xs text-xs" data-testid={`solicitors-firm-input-${side}`}
                onKeyDown={e => { if (e.key === "Enter" && typed.length >= 3) run({ firm: typed, side }); }} />
              <Button size="sm" variant="outline" className="h-8 px-2 text-xs" disabled={typed.length < 3 || check.isPending} onClick={() => run({ firm: typed, side })} data-testid={`solicitors-check-${side}`}>
                {busyFor(typed, side) ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Search className="w-3 h-3 mr-1" />}Check
              </Button>
            </div>
          </div>
        );
      })}
      {check.isPending && !choice && <p className="text-muted-foreground">{check.variables?.side === "client" ? "Checking the SRA's register." : "Checking the SRA's register and searching the web: about a minute."}</p>}
      {usesSra && (
        <p className="text-[11px] text-muted-foreground" data-testid="sra-attribution">
          <a href={SRA_ATTRIBUTION_URL} target="_blank" rel="noreferrer" className="hover:underline">{SRA_ATTRIBUTION_WORDS}</a>.
        </p>
      )}
    </div>
  );
}
