// AML training on screen (Woody, 19 November 2026: BGP's AML policy,
// section L). Each person's own record on My BGP, with "I have read the AML
// policy"; everyone's for the Nominated Officer, the Deputy and admins on the
// AML dashboard, where they record a session. The rules are
// shared/aml-training.ts; the routes server/aml-training.ts.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BookOpenCheck, CheckCircle2, Clock, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pill, PillCount } from "@/components/ui/pill";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { AML_TRAINING_TOPICS, topicWords, type AmlTrainingRow } from "@shared/aml-training";

const plain = (e: unknown) => String((e as any)?.message || e || "").replace(/^\d{3}:\s*/, "").replace(/^\{"message":"(.*?)"(,.*)?\}$/, "$1");
const day = (iso: string | null | undefined) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");
interface Standing { lastTrainedOn: string | null; due: boolean; readPolicy: boolean }

function refreshTraining() {
  queryClient.invalidateQueries({ predicate: q => String(q.queryKey[0] || "").startsWith("/api/aml-training") });
}

function RecordList({ records, canRemove }: { records: AmlTrainingRow[]; canRemove?: boolean }) {
  const { toast } = useToast();
  const remove = useMutation({
    mutationFn: async (id: number) => (await apiRequest("DELETE", `/api/aml-training/${id}`)).json(),
    onSuccess: () => { refreshTraining(); toast({ title: "Removed" }); },
    onError: (e: any) => toast({ title: "Not removed", description: plain(e), variant: "destructive" }),
  });
  if (!records.length) return <p className="text-sm text-muted-foreground" data-testid="aml-training-none">No AML training recorded yet.</p>;
  return (
    <ul className="divide-y rounded-lg border bg-card" data-testid="aml-training-records">
      {records.map(r => (
        <li key={r.id} className="p-2.5 text-sm flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="font-medium">{r.title}</div>
            <div className="text-xs text-muted-foreground">
              {day(r.trainedOn)} · {r.kindWords}{r.provider ? ` · ${r.provider}` : ""}{r.recordedBy ? ` · recorded by ${r.recordedBy}` : ""}
            </div>
            {!!r.topics.length && <div className="text-xs text-muted-foreground mt-0.5">{r.topics.map(topicWords).join("; ")}</div>}
            {r.notes && <div className="text-xs mt-0.5">{r.notes}</div>}
          </div>
          {canRemove && (
            <button type="button" className="text-muted-foreground hover:text-destructive" title="Remove a record entered by mistake" onClick={() => { if (window.confirm(`Remove "${r.title}" for ${r.userName}?`)) remove.mutate(r.id); }}>
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** One person's AML training, on their My BGP profile (theirs, or an officer's or admin's view of it). */
export function AmlTrainingPanel({ userId, isOwn }: { userId: string; isOwn: boolean }) {
  const { toast } = useToast();
  const { data, isLoading, error } = useQuery<{ records: AmlTrainingRow[]; standing: Standing; policyReadTitle: string }>({
    queryKey: isOwn ? ["/api/aml-training/me"] : ["/api/aml-training/person", userId],
  });
  const read = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/aml-training/me/read-policy", {})).json(),
    onSuccess: () => { refreshTraining(); toast({ title: "Recorded", description: "Kept with your training records for five years." }); },
    onError: (e: any) => toast({ title: "Not recorded", description: plain(e), variant: "destructive" }),
  });
  if (isLoading) return <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />;
  if (error || !data) return <p className="text-sm text-destructive">{plain(error) || "The training records could not be read."}</p>;
  const s = data.standing;
  return (
    <div className="space-y-3" data-testid="aml-training-panel">
      <p className="text-sm text-muted-foreground">Who has had AML training and confirmed the current policy. Kept for five years.</p>
      <div className="flex flex-wrap gap-2 text-sm">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${s.due ? "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"}`} data-testid="aml-training-last">
          {s.due ? <Clock className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
          {s.lastTrainedOn ? `Last trained ${day(s.lastTrainedOn)}${s.due ? ": over a year ago" : ""}` : "No training recorded"}
        </span>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${s.readPolicy ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" : "bg-muted text-muted-foreground"}`} data-testid="aml-training-policy-read">
          <BookOpenCheck className="w-3.5 h-3.5" />{s.readPolicy ? "Has read the current AML policy" : "Has not confirmed reading the current AML policy"}
        </span>
      </div>
      {isOwn && !s.readPolicy && (
        <div className="rounded-lg border bg-card p-3 text-sm space-y-2" data-testid="aml-training-read-box">
          <div>Read BGP's AML policy (Transactions, AML: download it there), then confirm here.</div>
          <Button type="button" size="sm" disabled={read.isPending} onClick={() => read.mutate()} data-testid="aml-training-read-policy">
            {read.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}I have read it: {data.policyReadTitle.replace(/^Read /, "")}
          </Button>
        </div>
      )}
      <RecordList records={data.records} />
    </div>
  );
}

function RecordTrainingDialog({ people, onClose }: { people: Array<{ userId: string; name: string }>; onClose: () => void }) {
  const { toast } = useToast();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"formal" | "informal">("formal");
  const [trainedOn, setTrainedOn] = useState(today);
  const [topics, setTopics] = useState<string[]>([]);
  const [provider, setProvider] = useState("");
  const [notes, setNotes] = useState("");
  const [who, setWho] = useState<string[]>([]);
  const save = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/aml-training", { title, kind, trainedOn, topics, provider, notes, userIds: who })).json(),
    onSuccess: (r: any) => { refreshTraining(); toast({ title: `Recorded for ${r?.recorded ?? who.length} ${r?.recorded === 1 ? "person" : "people"}` }); onClose(); },
    onError: (e: any) => toast({ title: "Not recorded", description: plain(e), variant: "destructive" }),
  });
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v]);
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="aml-training-record-dialog">
        <DialogHeader>
          <DialogTitle>Record AML training</DialogTitle>
          <DialogDescription>A course, a briefing, or an email or article sent round (the policy counts informal training too).</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2"><Label>What it was</Label><Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. AML refresher with KYC4U" data-testid="aml-training-title" /></div>
            <div className="space-y-1.5">
              <Label>Kind</Label>
              <Select value={kind} onValueChange={v => setKind(v as "formal" | "informal")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="formal">Formal training</SelectItem><SelectItem value="informal">Informal (an email, article or briefing)</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Date</Label><Input type="date" value={trainedOn} max={today} onChange={e => setTrainedOn(e.target.value)} data-testid="aml-training-date" /></div>
            <div className="space-y-1.5 sm:col-span-2"><Label>Given by</Label><Input value={provider} onChange={e => setProvider(e.target.value)} placeholder="Optional" /></div>
          </div>
          <div className="space-y-1.5">
            <Label>What it covered</Label>
            {AML_TRAINING_TOPICS.map(t => (
              <label key={t.key} className="flex items-center gap-2"><Checkbox checked={topics.includes(t.key)} onCheckedChange={() => setTopics(prev => toggle(prev, t.key))} data-testid={`aml-training-topic-${t.key}`} />{t.label}</label>
            ))}
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between"><Label>Who did it</Label><button type="button" className="text-xs text-primary hover:underline" onClick={() => setWho(who.length === people.length ? [] : people.map(p => p.userId))}>{who.length === people.length ? "Clear" : "Everyone"}</button></div>
            <div className="grid gap-1 sm:grid-cols-2 max-h-48 overflow-y-auto rounded-md border p-2">
              {people.map(p => (
                <label key={p.userId} className="flex items-center gap-2 text-xs"><Checkbox checked={who.includes(p.userId)} onCheckedChange={() => setWho(prev => toggle(prev, p.userId))} />{p.name}</label>
              ))}
            </div>
          </div>
          <div className="space-y-1.5"><Label>Notes</Label><Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} /></div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={!title.trim() || !topics.length || !who.length || save.isPending} onClick={() => save.mutate()} data-testid="aml-training-save">
            {save.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}Record
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Everyone's standing, for the Nominated Officer, the Deputy and admins. */
export function AmlTrainingBoard() {
  const { data, isLoading, error } = useQuery<{ people: Array<{ userId: string; name: string; team: string | null; records: number } & Standing>; recent: AmlTrainingRow[] }>({ queryKey: ["/api/aml-training"] });
  const [filter, setFilter] = useState<"all" | "due" | "unread">("due");
  const [recording, setRecording] = useState(false);
  if (isLoading) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Reading the training records…</div>;
  if (error || !data) return <p className="text-sm text-destructive">{plain(error) || "The training records could not be read."}</p>;
  const due = data.people.filter(p => p.due);
  const unread = data.people.filter(p => !p.readPolicy);
  const shown = filter === "due" ? due : filter === "unread" ? unread : data.people;
  return (
    <div className="space-y-3" data-testid="aml-training-board">
      <div className="flex flex-wrap items-center gap-1.5">
        <Pill active={filter === "due"} onClick={() => setFilter("due")} data-testid="aml-training-pill-due">Nothing in a year<PillCount n={due.length} active={filter === "due"} /></Pill>
        <Pill active={filter === "unread"} onClick={() => setFilter("unread")} data-testid="aml-training-pill-unread">Policy not confirmed<PillCount n={unread.length} active={filter === "unread"} /></Pill>
        <Pill active={filter === "all"} onClick={() => setFilter("all")} data-testid="aml-training-pill-all">Everyone<PillCount n={data.people.length} active={filter === "all"} /></Pill>
        <Button type="button" size="sm" className="ml-auto h-8" onClick={() => setRecording(true)} data-testid="aml-training-record"><Plus className="w-3.5 h-3.5 mr-1" />Record training</Button>
      </div>
      {!shown.length ? <p className="text-sm text-muted-foreground">Nobody here.</p> : (
        <div className="rounded-lg border overflow-x-auto">
          <table className="w-full text-sm" data-testid="aml-training-table">
            <thead className="bg-muted/50 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr><th className="text-left font-medium px-3 py-2">Person</th><th className="text-left font-medium px-3 py-2">Last trained</th><th className="text-left font-medium px-3 py-2">Read the policy</th><th className="text-right font-medium px-3 py-2">Records</th></tr>
            </thead>
            <tbody className="divide-y">
              {shown.map(p => (
                <tr key={p.userId}>
                  <td className="px-3 py-2"><div className="font-medium">{p.name}</div>{p.team && <div className="text-[11px] text-muted-foreground">{p.team}</div>}</td>
                  <td className={`px-3 py-2 ${p.due ? "text-amber-700 dark:text-amber-300" : ""}`}>{p.lastTrainedOn ? day(p.lastTrainedOn) : "Never"}</td>
                  <td className="px-3 py-2">{p.readPolicy ? "Yes" : <span className="text-muted-foreground">Not yet</span>}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{p.records}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!!data.recent.length && (
        <div className="space-y-1.5">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recently recorded</div>
          <RecordList records={data.recent.slice(0, 20)} canRemove />
        </div>
      )}
      {recording && <RecordTrainingDialog people={data.people.map(p => ({ userId: p.userId, name: p.name }))} onClose={() => setRecording(false)} />}
    </div>
  );
}
