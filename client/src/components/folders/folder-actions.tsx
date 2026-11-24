// What a person does to the files and folders in an open folder (Woody, 24
// November 2026; docs/folders-review-2026-11-20.md, 4.5 and step 3 of 4.9):
// a new folder, rename, delete to the recycle bin, share a link or invite
// people, preview, and the progress of uploads and copies. App dialogs only
// (a window on a computer, a sheet from the bottom on a phone), never a
// browser prompt. Everything runs on the person's own Microsoft 365.
import { useEffect, useRef, useState } from "react";
import { Check, Copy as CopyIcon, ExternalLink, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { inviteEmails, itemNameProblem, type DriveEntry } from "@shared/folders";
import { FolderApiError, folderApi, folderUpload, refreshListings } from "./folder-api";
import { FolderDialog } from "./folder-dialog";

export const formatBytes = (n: number | null) => n == null ? "" : n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : n < 1024 * 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
const itemPath = (e: { driveId: string; itemId: string }) => `/api/folders/items/${encodeURIComponent(e.driveId)}/${encodeURIComponent(e.itemId)}`;
const label = "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";

/** A new folder inside the folder being browsed. */
export function NewFolderDialog({ here, open, onOpenChange }: { here: DriveEntry | { driveId: string; itemId: string; name: string }; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => { if (open) { setName(""); setProblem(null); setBusy(false); } }, [open]);
  const nameProblem = itemNameProblem(name);
  const make = async () => {
    setBusy(true); setProblem(null);
    try {
      await folderApi("POST", `${itemPath(here)}/folders`, { name: name.trim() });
      await refreshListings();
      toast({ title: `${name.trim()} made`, description: `In ${here.name}.` });
      onOpenChange(false);
    } catch (e: any) { setProblem(e?.message || "Not made."); }
    finally { setBusy(false); }
  };
  return (
    <FolderDialog open={open} onOpenChange={o => { if (!busy) onOpenChange(o); }} title="New folder" description={`Made in ${here.name}.`} size="sm" testId="folder-new-dialog"
      footer={<>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
        <Button type="button" onClick={make} disabled={busy || !!nameProblem} data-testid="folder-new-make">{busy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null}Make it</Button>
      </>}
    >
      <Input autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !nameProblem && !busy) make(); }} placeholder="Folder name" className="h-9 text-sm" data-testid="folder-new-name" />
      {name.trim() && nameProblem && <p className="text-xs text-destructive">{nameProblem}</p>}
      {problem && <p className="text-sm text-destructive">{problem}</p>}
    </FolderDialog>
  );
}

/** A new name for a file or folder; a file's extension is kept unless the person changes it. */
export function RenameItemDialog({ item, onClose }: { item: DriveEntry | null; onClose: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!item) return;
    setName(item.name); setProblem(null); setBusy(false);
    // Select the name without its extension, as SharePoint does.
    const dot = item.isFolder ? -1 : item.name.lastIndexOf(".");
    setTimeout(() => { input.current?.focus(); input.current?.setSelectionRange(0, dot > 0 ? dot : item.name.length); }, 50);
  }, [item]);
  const nameProblem = itemNameProblem(name);
  const save = async () => {
    if (!item) return;
    if (name.trim() === item.name) return onClose();
    setBusy(true); setProblem(null);
    try {
      await folderApi("POST", `${itemPath(item)}/rename`, { name: name.trim() });
      await refreshListings();
      toast({ title: "Renamed", description: `${item.name} is now ${name.trim()}.` });
      onClose();
    } catch (e: any) { setProblem(e?.message || "Not renamed."); }
    finally { setBusy(false); }
  };
  return (
    <FolderDialog open={!!item} onOpenChange={o => { if (!o && !busy) onClose(); }} title={`Rename ${item?.isFolder ? "folder" : "file"}`} description="In SharePoint, for everyone. Links to it keep working." size="sm" testId="folder-rename-dialog"
      footer={<>
        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button type="button" onClick={save} disabled={busy || !!nameProblem} data-testid="folder-rename-save">{busy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null}Rename</Button>
      </>}
    >
      <Input ref={input} value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !nameProblem && !busy) save(); }} className="h-9 text-sm" data-testid="folder-rename-name" />
      {name.trim() && nameProblem && <p className="text-xs text-destructive">{nameProblem}</p>}
      {problem && <p className="text-sm text-destructive">{problem}</p>}
    </FolderDialog>
  );
}

/** Deleting goes to the library's recycle bin in SharePoint, where it can be put back. */
export function DeleteItemsDialog({ items, onClose, onDone }: { items: DriveEntry[] | null; onClose: () => void; onDone?: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  useEffect(() => { if (items) { setBusy(false); setProblems([]); } }, [items]);
  const count = items?.length || 0;
  const run = async () => {
    if (!items) return;
    setBusy(true);
    const failed: string[] = [];
    let done = 0;
    for (const it of items) {
      try { await folderApi("DELETE", itemPath(it)); done++; }
      catch (e: any) { failed.push(`${it.name}: ${e?.message || "not deleted"}`); }
    }
    await refreshListings();
    setBusy(false);
    if (done) toast({ title: `${done} deleted`, description: "In the SharePoint recycle bin, where they can be put back." });
    if (failed.length) { setProblems(failed); return; }
    onDone?.();
    onClose();
  };
  return (
    <FolderDialog open={!!items} onOpenChange={o => { if (!o && !busy) onClose(); }} title={count === 1 ? `Delete ${items![0].name}?` : `Delete ${count} items?`}
      description="They go to the recycle bin of the SharePoint library, where they can be put back for 93 days. A folder takes everything inside it." size="sm" testId="folder-delete-dialog"
      footer={<>
        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button type="button" variant="destructive" onClick={run} disabled={busy} data-testid="folder-delete-confirm">{busy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null}Delete</Button>
      </>}
    >
      {count > 1 && <p className="text-xs text-muted-foreground break-words">{items!.map(i => i.name).join(", ")}</p>}
      {problems.length > 0 && <ul className="text-sm text-destructive space-y-1" data-testid="folder-delete-problems">{problems.map(p => <li key={p}>{p}</li>)}</ul>}
    </FolderDialog>
  );
}

/** A link to send (anyone with it, or people at BGP; view or edit), or named people invited by email. */
export function ShareItemDialog({ item, onClose }: { item: DriveEntry | null; onClose: () => void }) {
  const { toast } = useToast();
  const [scope, setScope] = useState<"anonymous" | "organization">("anonymous");
  const [edit, setEdit] = useState(false);
  const [link, setLink] = useState<{ url: string; scope: string; fellBack: boolean } | null>(null);
  const [emails, setEmails] = useState("");
  const [write, setWrite] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<"link" | "invite" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (item) { setScope("anonymous"); setEdit(false); setLink(null); setEmails(""); setWrite(false); setMessage(""); setBusy(null); setProblem(null); setCopied(false); } }, [item]);
  const makeLink = async () => {
    if (!item) return;
    setBusy("link"); setProblem(null); setCopied(false);
    try { setLink(await folderApi("POST", `${itemPath(item)}/share`, { scope, edit })); }
    catch (e: any) { setProblem(e?.message || "No link was made."); }
    finally { setBusy(null); }
  };
  const people = inviteEmails(emails);
  const invite = async () => {
    if (!item || !people) return;
    setBusy("invite"); setProblem(null);
    try {
      await folderApi("POST", `${itemPath(item)}/invite`, { emails: people, write, message });
      toast({ title: `Invited ${people.length === 1 ? people[0] : `${people.length} people`}`, description: "SharePoint emails them; they sign in to open it." });
      setEmails(""); setMessage("");
    } catch (e: any) { setProblem(e?.message || "Nobody was invited."); }
    finally { setBusy(null); }
  };
  return (
    <FolderDialog open={!!item} onOpenChange={o => { if (!o && !busy) onClose(); }} title={`Share ${item?.name || ""}`} description="A link to send, or named people invited by email." testId="folder-share-dialog"
      footer={<Button type="button" variant="outline" onClick={onClose}>Done</Button>}
    >
      <div className="space-y-2.5">
        <div className={label}>A link</div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Pill active={scope === "anonymous"} onClick={() => { setScope("anonymous"); setLink(null); }} data-testid="folder-share-anyone">Anyone with the link</Pill>
          <Pill active={scope === "organization"} onClick={() => { setScope("organization"); setLink(null); }} data-testid="folder-share-bgp">People at BGP</Pill>
          <span className="mx-1 h-4 w-px bg-border" />
          <Pill active={!edit} onClick={() => { setEdit(false); setLink(null); }}>View</Pill>
          <Pill active={edit} onClick={() => { setEdit(true); setLink(null); }}>Edit</Pill>
        </div>
        {link ? (
          <div className="space-y-1.5" data-testid="folder-share-link">
            <div className="flex gap-2">
              <Input readOnly value={link.url} className="h-9 text-xs font-mono" onFocus={e => e.currentTarget.select()} />
              <Button type="button" size="sm" variant="outline" className="h-9" onClick={async () => { try { await navigator.clipboard.writeText(link.url); setCopied(true); } catch { setProblem("Select the link and copy it."); } }} data-testid="folder-share-copy">
                {copied ? <Check className="w-3.5 h-3.5 mr-1" /> : <CopyIcon className="w-3.5 h-3.5 mr-1" />}{copied ? "Copied" : "Copy"}
              </Button>
            </div>
            {link.fellBack && <p className="text-xs text-muted-foreground">BGP's SharePoint does not allow links for anyone, so this link opens for people at BGP only. To share outside BGP, invite people by email below.</p>}
          </div>
        ) : (
          <Button type="button" size="sm" onClick={makeLink} disabled={!!busy} data-testid="folder-share-make">{busy === "link" ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null}Make the link</Button>
        )}
      </div>
      <div className="space-y-2.5 border-t border-border pt-3">
        <div className={label}>Invite people</div>
        <Input value={emails} onChange={e => setEmails(e.target.value)} placeholder="Email addresses, separated by commas" className="h-9 text-sm" data-testid="folder-invite-emails" />
        {emails.trim() && !people && <p className="text-xs text-destructive">Give up to 20 email addresses, separated by commas.</p>}
        <div className="flex flex-wrap items-center gap-1.5">
          <Pill active={!write} onClick={() => setWrite(false)}>Can view</Pill>
          <Pill active={write} onClick={() => setWrite(true)}>Can edit</Pill>
        </div>
        <Textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="A message (optional)" rows={2} className="text-sm" />
        <Button type="button" size="sm" variant="outline" onClick={invite} disabled={!!busy || !people} data-testid="folder-invite-send">{busy === "invite" ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null}Send invitation</Button>
      </div>
      {problem && <p className="text-sm text-destructive" data-testid="folder-share-problem">{problem}</p>}
    </FolderDialog>
  );
}

/** SharePoint's own preview of a file, as the person who asked for it. */
export function PreviewItemDialog({ item, onClose }: { item: DriveEntry | null; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null); setProblem(null);
    if (!item) return;
    let live = true;
    folderApi<{ url: string }>("POST", `${itemPath(item)}/preview`)
      .then(r => { if (live) setUrl(r.url); })
      .catch((e: any) => { if (live) setProblem(e?.message || "No preview."); });
    return () => { live = false; };
  }, [item]);
  return (
    <FolderDialog open={!!item} onOpenChange={o => { if (!o) onClose(); }} title={item?.name || "Preview"} size="lg" testId="folder-preview-dialog"
      footer={<>
        {item?.webUrl && <a href={item.webUrl} target="_blank" rel="noopener noreferrer" className="mr-auto inline-flex items-center gap-1 text-xs text-primary hover:underline"><ExternalLink className="w-3 h-3" />Open in SharePoint</a>}
        <Button type="button" variant="outline" onClick={onClose}>Close</Button>
      </>}
    >
      {problem ? <p className="text-sm text-muted-foreground" data-testid="folder-preview-problem">{problem}</p>
        : url ? <iframe src={url} title={`Preview of ${item?.name}`} className="w-full h-[65dvh] rounded-md border border-border bg-background" referrerPolicy="no-referrer" data-testid="folder-preview-frame" />
          : <Skeleton className="w-full h-[65dvh]" />}
    </FolderDialog>
  );
}

// ── Uploads ─────────────────────────────────────────────────────────────
export interface UploadRow { id: number; name: string; size: number; to: string; percent: number | null; state: "waiting" | "going" | "done" | "failed" | "stopped"; error?: string }

/** Files into a folder one after another, each with its progress. */
export function useUploads() {
  const { toast } = useToast();
  const [rows, setRows] = useState<UploadRow[]>([]);
  const queue = useRef<Array<{ id: number; file: File; target: { driveId: string; itemId: string; name: string } }>>([]);
  const stopped = useRef(new Set<number>());
  const running = useRef(false);
  const next = useRef(1);
  const patch = (id: number, p: Partial<UploadRow>) => setRows(rs => rs.map(r => (r.id === id ? { ...r, ...p } : r)));
  const pump = async () => {
    if (running.current) return;
    running.current = true;
    let done = 0;
    let target = "";
    while (queue.current.length) {
      const job = queue.current.shift()!;
      if (stopped.current.has(job.id)) continue;
      patch(job.id, { state: "going", percent: 0 });
      try {
        await folderUpload(job.target, job.file, p => patch(job.id, { percent: p }), () => stopped.current.has(job.id));
        patch(job.id, { state: "done", percent: 100 });
        done++;
        target = job.target.name;
      } catch (e: any) {
        patch(job.id, stopped.current.has(job.id) ? { state: "stopped" } : { state: "failed", error: e instanceof FolderApiError || e?.message ? e.message : "Not uploaded." });
      }
    }
    running.current = false;
    if (done) {
      await refreshListings();
      toast({ title: `${done} file${done === 1 ? "" : "s"} uploaded`, description: `To ${target}.` });
    }
  };
  return {
    rows,
    add(files: File[], target: { driveId: string; itemId: string; name: string }) {
      const added = files.map(file => ({ id: next.current++, file, target }));
      queue.current.push(...added);
      setRows(rs => [...rs, ...added.map(a => ({ id: a.id, name: a.file.name, size: a.file.size, to: target.name, percent: null, state: "waiting" as const }))]);
      void pump();
    },
    stop(id: number) { stopped.current.add(id); setRows(rs => rs.map(r => (r.id === id && r.state === "waiting" ? { ...r, state: "stopped" } : r))); },
    clear() { setRows(rs => rs.filter(r => r.state === "waiting" || r.state === "going")); },
  };
}

export function UploadProgress({ rows, onStop, onClear, testId = "folder-uploads" }: { rows: UploadRow[]; onStop: (id: number) => void; onClear: () => void; testId?: string }) {
  if (!rows.length) return null;
  const finished = rows.every(r => r.state !== "waiting" && r.state !== "going");
  return (
    <div className="rounded-md border border-border p-2 space-y-1.5" data-testid={testId}>
      <div className="flex items-center gap-2">
        <span className={label}>Uploads</span>
        {finished && <button type="button" className="ml-auto text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground" onClick={onClear}>Clear</button>}
      </div>
      {rows.map(r => (
        <div key={r.id} className="space-y-1" data-testid={`${testId}-row`}>
          <div className="flex items-center gap-2 text-xs">
            <span className="min-w-0 flex-1 truncate">{r.name}</span>
            <span className="font-mono tabular-nums text-[11px] text-muted-foreground">{formatBytes(r.size)}</span>
            <span className="w-24 text-right text-[11px] text-muted-foreground">
              {r.state === "waiting" ? "Waiting" : r.state === "going" ? (r.percent == null ? "Uploading…" : `${r.percent}%`) : r.state === "done" ? "Uploaded" : r.state === "stopped" ? "Stopped" : "Not uploaded"}
            </span>
            {(r.state === "waiting" || r.state === "going") && (
              <button type="button" className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Stop ${r.name}`} title="Stop" onClick={() => onStop(r.id)}><X className="w-3.5 h-3.5" /></button>
            )}
          </div>
          {r.state === "going" && (
            <div className="h-1 overflow-hidden rounded-full bg-muted">
              <div className={r.percent == null ? "h-full w-1/3 animate-pulse rounded-full bg-foreground/40" : "h-full rounded-full bg-foreground/60 transition-[width]"} style={r.percent == null ? undefined : { width: `${r.percent}%` }} />
            </div>
          )}
          {r.state === "failed" && r.error && <p className="text-[11px] text-destructive">{r.error}</p>}
        </div>
      ))}
    </div>
  );
}

// ── Copies ──────────────────────────────────────────────────────────────
export interface CopyRow { jobId: string; name: string; to: string; state: "running" | "done" | "failed" | "unknown"; percent: number | null; error?: string | null; unfollowed?: boolean }

/** Copies SharePoint makes in the background, asked how far they have got every two seconds. */
export function useCopies() {
  const { toast } = useToast();
  const [rows, setRows] = useState<CopyRow[]>([]);
  const running = rows.some(r => r.state === "running" && !r.unfollowed);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(async () => {
      const now = rows.filter(r => r.state === "running" && !r.unfollowed);
      for (const r of now) {
        try {
          const s = await folderApi<{ state: "running" | "done" | "failed"; percent: number | null; error: string | null; unfollowed?: boolean }>("GET", `/api/folders/copies/${encodeURIComponent(r.jobId)}`);
          setRows(rs => rs.map(x => (x.jobId === r.jobId ? { ...x, state: s.state, percent: s.percent, error: s.error, unfollowed: s.unfollowed } : x)));
          if (s.state === "done") { await refreshListings(); toast({ title: `${r.name} copied`, description: `To ${r.to}.` }); }
        } catch (e: any) {
          setRows(rs => rs.map(x => (x.jobId === r.jobId ? { ...x, state: "unknown", error: e?.message || "Look in the folder it was copied to." } : x)));
        }
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [running, rows]);
  return {
    rows,
    async start(items: DriveEntry[], to: DriveEntry) {
      const failed: string[] = [];
      for (const it of items) {
        try {
          const r = await folderApi<{ jobId: string; name: string; followed: boolean }>("POST", `${itemPath(it)}/copy`, { toDriveId: to.driveId, toParentId: to.itemId });
          setRows(rs => [...rs, { jobId: r.jobId, name: r.name, to: to.name, state: "running", percent: null, unfollowed: !r.followed }]);
        } catch (e: any) { failed.push(`${it.name}: ${e?.message || "not copied"}`); }
      }
      if (failed.length) throw new Error(failed.join(" "));
    },
    clear() { setRows(rs => rs.filter(r => r.state === "running" && !r.unfollowed)); },
  };
}

export function CopyProgress({ rows, onClear, testId = "folder-copies" }: { rows: CopyRow[]; onClear: () => void; testId?: string }) {
  if (!rows.length) return null;
  const finished = rows.every(r => r.state !== "running" || r.unfollowed);
  return (
    <div className="rounded-md border border-border p-2 space-y-1.5" data-testid={testId}>
      <div className="flex items-center gap-2">
        <span className={label}>Copies</span>
        {finished && <button type="button" className="ml-auto text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground" onClick={onClear}>Clear</button>}
      </div>
      {rows.map(r => (
        <div key={r.jobId} className="space-y-1" data-testid={`${testId}-row`}>
          <div className="flex items-center gap-2 text-xs">
            <span className="min-w-0 flex-1 truncate">{r.name} <span className="text-muted-foreground">to {r.to}</span></span>
            <span className="text-right text-[11px] text-muted-foreground">
              {r.unfollowed ? "SharePoint is copying it" : r.state === "running" ? (r.percent == null ? "Copying…" : `${r.percent}%`) : r.state === "done" ? "Copied" : r.state === "failed" ? "Not copied" : "Not known"}
            </span>
          </div>
          {r.state === "running" && !r.unfollowed && (
            <div className="h-1 overflow-hidden rounded-full bg-muted">
              <div className={r.percent == null ? "h-full w-1/3 animate-pulse rounded-full bg-foreground/40" : "h-full rounded-full bg-foreground/60 transition-[width]"} style={r.percent == null ? undefined : { width: `${r.percent}%` }} />
            </div>
          )}
          {(r.state === "failed" || r.state === "unknown") && r.error && <p className="text-[11px] text-muted-foreground">{r.error}</p>}
        </div>
      ))}
    </div>
  );
}
