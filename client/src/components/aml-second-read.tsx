// The officers' second read of an enhanced party's file (Jack, 20 November
// 2026: "use AI only as a second reader when signing off as Nominated
// Officer", for any enhanced party). It lists what the file shows against
// BGP's checklist, with the words read; it decides nothing and saves nothing.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, CircleDashed, CircleHelp, Loader2, ScanSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { SECOND_READ_WORDS, type SecondRead, type SecondReadStatus } from "@shared/aml-second-read";

const plain = (e: unknown) => String((e as any)?.message || e).replace(/^\d+:\s*/, "").replace(/^\{"message":"(.*)"\}$/, "$1");

const TONE: Record<SecondReadStatus, string> = {
  found: "text-emerald-700 dark:text-emerald-400",
  partly: "text-amber-700 dark:text-amber-300",
  missing: "text-red-700 dark:text-red-400",
};
function StatusIcon({ status }: { status: SecondReadStatus }) {
  if (status === "found") return <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />;
  if (status === "partly") return <CircleHelp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />;
  return <CircleDashed className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" />;
}

export function SecondReadPanel({ dealId, role, partyName, trust }: { dealId: string; role: string; partyName: string; trust: boolean }) {
  const [read, setRead] = useState<SecondRead | null>(null);
  const run = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/deals/${dealId}/parties/${role}/second-read`, {})).json() as Promise<SecondRead>,
    onSuccess: setRead,
  });
  return (
    <div className="space-y-2 rounded-md border border-border/70 bg-muted/30 px-2.5 py-2 text-xs" data-testid={`aml-second-read-${role}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" className="h-7 text-xs bg-background" disabled={run.isPending} onClick={() => run.mutate()} data-testid={`aml-second-read-run-${role}`}>
          {run.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <ScanSearch className="mr-1 h-3.5 w-3.5" />}
          {read ? "Read again" : "Second read"}
        </Button>
        <span className="text-muted-foreground">
          {run.isPending ? "Reading the file: up to two minutes." : `Reads ${partyName}'s documents and BGP's record against the ${trust ? "trust" : "enhanced due diligence"} checklist and lists what it finds. It decides nothing: the sign-off is yours.`}
        </span>
      </div>
      {run.isError && <p className="text-red-700 dark:text-red-400">{plain(run.error)}</p>}
      {read?.unreadable && <p className="text-amber-800 dark:text-amber-300">{read.unreadable}</p>}
      {read && !read.unreadable && (
        <div className="space-y-2">
          <p className="text-muted-foreground">
            {read.items.filter(i => i.status === "found").length} of {read.items.length} items found in the file
            {" "}· read {new Date(read.readAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })}
          </p>
          <ul className="space-y-1.5">
            {read.items.map(i => (
              <li key={i.n} className="flex items-start gap-1.5" data-testid={`aml-second-read-item-${i.n}`}>
                <StatusIcon status={i.status} />
                <div className="min-w-0">
                  <span className="font-medium">{i.n}. {i.title}</span>
                  <span className={`ml-1.5 ${TONE[i.status]}`}>{SECOND_READ_WORDS[i.status]}{i.where ? ` in ${i.where}` : ""}</span>
                  {i.quote && (
                    <blockquote className="mt-0.5 border-l-2 border-border pl-2 italic text-muted-foreground">
                      “{i.quote}”{i.quoteChecked === null ? <span className="not-italic"> (a picture: check it by eye)</span> : null}
                    </blockquote>
                  )}
                  {i.note && <p className="text-muted-foreground">{i.note}</p>}
                </div>
              </li>
            ))}
          </ul>
          {read.concerns.length > 0 && (
            <div className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              <p className="flex items-center gap-1 font-medium"><AlertTriangle className="h-3.5 w-3.5" />Worth a look</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {read.concerns.map((c, k) => <li key={k}>{c.text}{c.where ? ` (${c.where})` : ""}{c.quote ? <span className="italic"> “{c.quote}”</span> : null}</li>)}
              </ul>
            </div>
          )}
          {read.documents.some(d => !d.read) && (
            <details className="text-muted-foreground">
              <summary className="cursor-pointer">{read.documents.filter(d => !d.read).length} document{read.documents.filter(d => !d.read).length === 1 ? "" : "s"} not read</summary>
              <ul className="mt-1 list-disc pl-4">{read.documents.filter(d => !d.read).map((d, k) => <li key={k}>{d.name}: {d.why}</li>)}</ul>
            </details>
          )}
          <p className="text-muted-foreground">A machine reading to check against the documents. Nothing here is saved or decided; record your reasons in the sign-off note.</p>
        </div>
      )}
    </div>
  );
}
