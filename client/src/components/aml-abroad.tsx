// Companies owned from abroad, on a party's AML box (Woody, 21 November 2026:
// "let's make sure all of that is built"). What the app traced past Companies
// House (the parent note in the accounts, GLEIF's chain), what BGP has
// recorded against each company abroad (its register page, a register extract
// or structure chart, a note, the people behind it), and the client's
// structure chart set against what the app found. The rules are
// shared/foreign-owners.ts; the routes server/kyc-abroad.ts. BGP staff only.
// The same section serves a client file (BGP's client checked with no
// transaction, 25 November 2026): its addresses come from aml-scope.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ExternalLink, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getAuthHeaders, queryClient } from "@/lib/queryClient";
import { useAmlUrls, type AmlUrls } from "@/lib/aml-scope";
import { sameCompany, type AbroadRecord, type AbroadStatus, type ChartComparison, type ChartReading, type PrecheckAbroad } from "@shared/foreign-owners";
import { gleifTraceWords, parentLineWords } from "@shared/foreign-owner-words";

export interface DealAbroad {
  partyName: string;
  owners: AbroadStatus[];
  trace: PrecheckAbroad | null;
  ranAt: string | null;
  names: Array<{ name: string; country: string | null }>;
  records: Array<AbroadRecord & { file: { url: string; name: string } | null }>;
  charts: Array<{
    source: "client" | "bgp"; documentId: string; fileName: string; url: string | null; at: string; from: string; ownerName: string | null;
    reading: ChartReading | null; comparison: ChartComparison | null;
  }>;
}

const keyFor = (dealId: string, role: string) => ["/api/deals", dealId, "parties", role, "abroad"];

export function useDealAbroad(dealId: string, role: string, enabled: boolean) {
  const urls = useAmlUrls();
  return useQuery<DealAbroad>({
    queryKey: keyFor(dealId, role), enabled: enabled && !!dealId, staleTime: 30_000,
    queryFn: async () => {
      const res = await fetch(`${urls.party(dealId, role)}/abroad`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.message || "The trace could not be read.");
      return res.json();
    },
    // A chart being read comes back in a few seconds.
    refetchInterval: q => ((q.state.data as DealAbroad | undefined)?.charts || []).some(c => !c.reading) ? 8000 : false,
  });
}

type Tone = "done" | "act" | "flag" | "wait" | "info";

/** The section's line: the companies abroad, and whether the people behind them are still to find. */
export function abroadSummary(data: DealAbroad | undefined, owners: Array<{ name: string; country: string }>, traceLines: string[]): { tone: Tone; words: string } {
  const named = (list: Array<{ name: string; country: string }>) => list.map(o => `${o.name} (${o.country})`).join(" and ");
  if (!data) return owners.length ? { tone: "act", words: `${named(owners)}: the people behind ${owners.length === 1 ? "it" : "them"} still to find` } : { tone: "info", words: traceLines[0] || "Not read yet" };
  if (!data.owners.length) {
    const parent = (data.trace?.accounts?.lines || []).find(l => !l.none);
    return { tone: "info", words: parent ? `The accounts name ${parentLineWords(parent)}` : traceLines[0] || "Nothing abroad found" };
  }
  const open = data.owners.filter(o => o.needs);
  if (open.length) return { tone: "act", words: `${named(data.owners)}: the people behind ${open.length === 1 && data.owners.length === 1 ? "it" : open.length === 1 ? open[0].name : "them"} still to find` };
  const people = [...new Set(data.owners.flatMap(o => o.people))];
  return { tone: "done", words: `${named(data.owners)}: ${people.join(", ")} recorded behind ${data.owners.length === 1 ? "it" : "them"}` };
}

const plain = (e: unknown) => String((e as any)?.message || e || "").replace(/^\d{3}:\s*/, "").replace(/^\{"message":"(.*)"(,.*)?\}$/, "$1");
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function refresh(dealId: string, role: string, urls: AmlUrls) {
  queryClient.invalidateQueries({ queryKey: keyFor(dealId, role) });
  queryClient.invalidateQueries({ queryKey: ["/api/kyc/deal", dealId, "status"] });
  queryClient.invalidateQueries({ queryKey: ["/api/aml/deal", dealId, "client-checks"] });
  // A client file's own view (its checks rerun when a person is recorded).
  if (urls.clientFile) queryClient.invalidateQueries({ queryKey: ["/api/client-kyc", urls.clientFile.companyId] });
}

type Mode = "page" | "file" | "chart" | "note" | "person";
const MODE_WORDS: Record<Mode, string> = { page: "Register page", file: "Register extract", chart: "Structure chart", note: "Note", person: "Person behind it" };

function AddToTrace({ dealId, role, names, owner, mode, onDone }: {
  dealId: string; role: string; names: DealAbroad["names"]; owner: string; mode: Mode; onDone: () => void;
}) {
  const { toast } = useToast();
  const [about, setAbout] = useState(owner);
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [name, setName] = useState("");
  const [detail, setDetail] = useState("");
  const [nationality, setNationality] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const urls = useAmlUrls();
  const base = `${urls.party(dealId, role)}/abroad`;
  const save = useMutation({
    mutationFn: async () => {
      if (mode === "file" || mode === "chart") {
        if (!file) throw new Error("Choose a file.");
        const fd = new FormData();
        fd.append("ownerName", about);
        fd.append("kind", mode === "chart" ? "chart" : "document");
        fd.append("file", file);
        const res = await fetch(`${base}/document`, { method: "POST", body: fd, credentials: "include", headers: getAuthHeaders() });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.message || "The file could not be added.");
        return body;
      }
      const path = mode === "page" ? "page" : mode === "note" ? "note" : "person";
      const body = mode === "page" ? { ownerName: about, url }
        : mode === "note" ? { ownerName: about, note }
        : { ownerName: about, name, detail, nationality: nationality || null, dobMonth: month ? Number(month) : null, dobYear: year ? Number(year) : null };
      return (await apiRequest("POST", `${base}/${path}`, body)).json();
    },
    onSuccess: (r: any) => {
      toast({ title: mode === "person" ? `${name} recorded: ${r?.screening === "now" ? "screening them now" : "screened on the next run of BGP's checks"}` : mode === "page" ? "Page copied to PDF and filed" : "Saved" });
      refresh(dealId, role, urls);
      onDone();
    },
    onError: (e) => toast({ title: "Not saved", description: plain(e), variant: "destructive" }),
  });
  const ready = mode === "page" ? /^https?:\/\/\S+\.\S+/i.test(url.trim())
    : mode === "file" || mode === "chart" ? !!file
    : mode === "note" ? note.trim().length >= 10
    : name.trim().split(/\s+/).length >= 2 && detail.trim().length >= 5;
  return (
    <div className="space-y-2 rounded-md border border-border/70 bg-muted/30 p-2 text-xs" data-testid={`abroad-add-${mode}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{MODE_WORDS[mode]}</span>
        <span className="text-muted-foreground">about</span>
        <select className="h-7 rounded border border-input bg-background px-1.5 text-xs" value={about} onChange={e => setAbout(e.target.value)} data-testid="abroad-add-about">
          {names.map(n => <option key={n.name} value={n.name}>{n.name}{n.country ? ` (${n.country})` : ""}</option>)}
        </select>
      </div>
      {mode === "page" && <>
        <Input className="h-8 text-xs" placeholder="https://… its page on its own country's company register" value={url} onChange={e => setUrl(e.target.value)} data-testid="abroad-add-url" />
        <p className="text-muted-foreground">The app saves a dated PDF copy on the party's KYC record. Some registers refuse automated copies: then save the page as a PDF yourself and add it as a register extract.</p>
      </>}
      {(mode === "file" || mode === "chart") && (
        <Input className="h-8 text-xs" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,application/pdf,image/*" onChange={e => setFile(e.target.files?.[0] || null)} data-testid="abroad-add-file" />
      )}
      {mode === "chart" && <p className="text-muted-foreground">The app reads the names on it and sets them against what it found.</p>}
      {mode === "note" && <Textarea rows={3} className="text-xs" placeholder="What you found, and where (e.g. its foundation owns no shares but holds a third of the votes)" value={note} onChange={e => setNote(e.target.value)} data-testid="abroad-add-note" />}
      {mode === "person" && <>
        <Input className="h-8 text-xs" placeholder="Full name, as the register gives it" value={name} onChange={e => setName(e.target.value)} data-testid="abroad-add-name" />
        <Input className="h-8 text-xs" placeholder="How they own or control it (e.g. 33–50% of the votes)" value={detail} onChange={e => setDetail(e.target.value)} data-testid="abroad-add-detail" />
        <div className="flex flex-wrap items-center gap-2">
          <Input className="h-8 w-40 text-xs" placeholder="Nationality" value={nationality} onChange={e => setNationality(e.target.value)} />
          <span className="text-muted-foreground">Born</span>
          <select className="h-8 rounded border border-input bg-background px-1.5 text-xs" value={month} onChange={e => setMonth(e.target.value)} aria-label="Month of birth">
            <option value="">Month</option>
            {MONTHS.map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
          </select>
          <Input className="h-8 w-20 text-xs" inputMode="numeric" placeholder="Year" value={year} onChange={e => setYear(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))} aria-label="Year of birth" />
        </div>
        <p className="text-muted-foreground">They join People to check, are screened as an owner, and then need an identity check (their own link) or verifying from public sources.</p>
      </>}
      <div className="flex gap-2">
        <Button type="button" size="sm" className="h-7 text-xs" disabled={!ready || save.isPending} onClick={() => save.mutate()} data-testid="abroad-add-save">
          {save.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}{mode === "page" ? "Copy and file it" : mode === "person" ? "Record them" : "Save"}
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={onDone}>Cancel</Button>
      </div>
    </div>
  );
}

function RecordLine({ dealId, role, r, about }: { dealId: string; role: string; r: DealAbroad["records"][number]; about?: string }) {
  const { toast } = useToast();
  const urls = useAmlUrls();
  const remove = useMutation({
    mutationFn: async () => (await apiRequest("POST", `${urls.party(dealId, role)}/abroad/${r.id}/remove`, {})).json(),
    onSuccess: () => refresh(dealId, role, urls),
    onError: (e) => toast({ title: "Not taken off", description: plain(e), variant: "destructive" }),
  });
  const what = r.kind === "person" && r.person
    ? <><span className="font-medium">{r.person.name}</span><span className="text-muted-foreground"> · {r.person.detail}{r.person.nationality ? ` · ${r.person.nationality}` : ""}{r.person.dob?.year ? ` · born ${r.person.dob.month ? `${MONTHS[r.person.dob.month - 1]} ` : ""}${r.person.dob.year}` : ""}</span></>
    : r.kind === "note" ? <span>{r.note}</span>
    : <>{r.file ? <a href={r.file.url} target="_blank" rel="noopener noreferrer" className="text-primary underline">{r.kind === "register_page" ? "Register page (PDF copy)" : r.kind === "chart" ? "Structure chart" : "Register extract"}</a> : <span>{r.kind === "register_page" ? "Register page" : "A file"} (no longer on the record)</span>}
      {r.sourceUrl && <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer" className="ml-1 inline-flex items-center text-muted-foreground hover:text-foreground" title={r.sourceUrl}><ExternalLink className="h-3 w-3" /></a>}</>;
  return (
    <li className="flex items-start gap-1.5" data-testid={`abroad-record-${r.id}`}>
      <span className="min-w-0 flex-1 break-words">{about && <span className="text-muted-foreground">{about}: </span>}{what}<span className="text-muted-foreground"> · {r.by}, {day(r.at)}</span></span>
      <button type="button" className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-50" title="Take it off the trace" aria-label="Take it off the trace" disabled={remove.isPending} onClick={() => remove.mutate()}>
        <X className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

function ChartBlock({ c }: { c: DealAbroad["charts"][number] }) {
  const r = c.reading;
  return (
    <div className="space-y-1 rounded border border-border/60 p-2" data-testid={`abroad-chart-${c.documentId}`}>
      <div>
        {c.url ? <a href={c.url} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline">{c.fileName}</a> : <span className="font-medium">{c.fileName}</span>}
        <span className="text-muted-foreground"> · from {c.from}, {day(c.at)}</span>
      </div>
      {!r ? <p className="text-muted-foreground"><Loader2 className="mr-1 inline h-3 w-3 animate-spin" />Reading the names on it…</p>
        : !r.read ? <p className="text-amber-800 dark:text-amber-300">Not read: {r.unreadable}. Open it and compare it by eye.</p>
        : c.comparison && <>
          {c.comparison.matched.length > 0 && <p><span className="text-muted-foreground">Matches what the app found: </span>{c.comparison.matched.map(m => m.chart).join(", ")}</p>}
          {c.comparison.chartOnly.length > 0 && <p className="text-amber-800 dark:text-amber-300">On the chart, not found by the app: {c.comparison.chartOnly.map(x => `${x.name}${x.country ? ` (${x.country})` : ""}`).join(", ")}</p>}
          {c.comparison.foundOnly.length > 0 && <p className="text-amber-800 dark:text-amber-300">Found by the app, not on the chart: {c.comparison.foundOnly.map(x => `${x.name} (${x.via})`).join(", ")}</p>}
          {!c.comparison.chartOnly.length && !c.comparison.foundOnly.length && <p className="text-emerald-800 dark:text-emerald-300">Every name on the chart matches what the app found.</p>}
          <p className="text-muted-foreground">Read by the app: check the percentages on the chart itself.</p>
        </>}
    </div>
  );
}

/** The section's detail. */
// sanctionsOnly: a letting under £10,000 a month, where nobody behind a company abroad
// has to be found, so the section shows what was found and offers nothing to add
// (Woody, 23 November 2026: "there are some pills to add some further docs but under
// documents says sanctions checks only?").
export function AbroadTrace({ dealId, role, query, sanctionsOnly = false }: { dealId: string; role: string; query: ReturnType<typeof useDealAbroad>; sanctionsOnly?: boolean }) {
  const [adding, setAdding] = useState<{ owner: string; mode: Mode } | null>(null);
  const data = query.data;
  if (query.isLoading) return <p className="text-xs text-muted-foreground"><Loader2 className="mr-1 inline h-3 w-3 animate-spin" />Reading the trace…</p>;
  if (query.isError || !data) return <p className="text-xs text-red-700">The trace could not be read.</p>;
  const trace = data.trace;
  const recordsFor = (name: string) => data.records.filter(r => sameCompany(r.ownerName, name));
  const shownRecords = new Set<string>();
  const ownerBlocks = data.owners.map(o => {
    const recs = recordsFor(o.name);
    recs.forEach(r => shownRecords.add(r.id));
    return { o, recs };
  });
  const otherRecords = data.records.filter(r => !shownRecords.has(r.id));
  const actions = (owner: string) => (
    <div className="flex flex-wrap gap-1.5">
      {(["page", "file", "person", "note", "chart"] as Mode[]).map(m => (
        <Button key={m} type="button" size="sm" variant="outline" className="h-6 bg-background px-2 text-[11px]" onClick={() => setAdding({ owner, mode: m })} data-testid={`abroad-action-${m}`}>
          {m === "page" ? "Add its register page" : m === "file" ? "Add a register extract" : m === "person" ? "Record a person behind it" : m === "note" ? "Add a note" : "Add a structure chart"}
        </Button>
      ))}
    </div>
  );
  return (
    <div className="space-y-3 text-xs" data-testid="abroad-trace">
      {ownerBlocks.map(({ o, recs }) => (
        <div key={o.name} className="space-y-1.5" data-testid={`abroad-owner-${o.name}`}>
          <p className="font-medium">{o.name} <span className="font-normal text-muted-foreground">({o.country})</span></p>
          <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">{o.found.map(f => <li key={f} className="break-words">{f}</li>)}</ul>
          {recs.length > 0 && <ul className="space-y-1">{recs.map(r => <RecordLine key={r.id} dealId={dealId} role={role} r={r} />)}</ul>}
          {o.needs && !sanctionsOnly && <p className="text-amber-800 dark:text-amber-300">Still to find: {o.needs}.</p>}
          {adding?.owner === o.name ? <AddToTrace dealId={dealId} role={role} names={data.names} owner={o.name} mode={adding.mode} onDone={() => setAdding(null)} /> : sanctionsOnly ? null : actions(o.name)}
        </div>
      ))}
      {!data.owners.length && data.names.length > 0 && (adding ? <AddToTrace dealId={dealId} role={role} names={data.names} owner={adding.owner} mode={adding.mode} onDone={() => setAdding(null)} /> : sanctionsOnly ? null : actions(data.names[0].name))}
      {sanctionsOnly && <p className="text-muted-foreground" data-testid="abroad-sanctions-only">Nothing to add: a letting under £10,000 a month needs the sanctions checks only.</p>}
      {otherRecords.length > 0 && (
        <div className="space-y-1">
          <p className="font-medium">Recorded against the companies above them</p>
          <ul className="space-y-1">{otherRecords.map(r => <RecordLine key={r.id} dealId={dealId} role={role} r={r} about={r.ownerName} />)}</ul>
        </div>
      )}
      {trace && (trace.accounts || trace.traced.length > 0) && (
        <div className="space-y-1" data-testid="abroad-sources">
          <p className="font-medium">What the app traced{data.ranAt ? <span className="font-normal text-muted-foreground"> · {day(data.ranAt)}</span> : null}</p>
          {trace.accounts && (trace.accounts.status === "found"
            ? trace.accounts.lines.map((l, i) => (
              <p key={i} className="break-words"><span className="text-muted-foreground">Accounts{trace.accounts?.madeUpTo ? ` to ${day(trace.accounts.madeUpTo)}` : ""}{trace.accounts?.via === "scan" ? `, read from the scanned filing${l.page ? ` (page ${l.page})` : ""}` : ""}: </span>{parentLineWords(l)} <span className="italic text-muted-foreground">"{l.words}"</span></p>
            ))
            : <p className="text-muted-foreground">Accounts{trace.accounts.madeUpTo ? ` to ${day(trace.accounts.madeUpTo)}` : ""}: {trace.accounts.status === "none" ? "no parent or controlling party named" : `not read for a parent (${trace.accounts.unread})`}.</p>)}
          {trace.traced.map(t => <p key={t.name} className="break-words"><span className="text-muted-foreground">GLEIF: </span>{gleifTraceWords(t)}{t.gleif.entity && <a className="ml-1 inline-flex items-center text-muted-foreground hover:text-foreground" href={`https://search.gleif.org/#/record/${t.gleif.entity.lei}`} target="_blank" rel="noopener noreferrer" title="Open its GLEIF record"><ExternalLink className="h-3 w-3" /></a>}</p>)}
        </div>
      )}
      {data.charts.length > 0 && (
        <div className="space-y-1.5">
          <p className="font-medium">Structure charts</p>
          {data.charts.map(c => <ChartBlock key={c.documentId} c={c} />)}
        </div>
      )}
      <p className="text-muted-foreground">What is traced and recorded here goes into the AML file.</p>
    </div>
  );
}

