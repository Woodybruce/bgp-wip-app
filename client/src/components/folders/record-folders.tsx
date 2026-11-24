// A record's Folders (Woody, 24 November 2026: "go ahead with the folder
// suggestion"; docs/folders-review-2026-11-20.md, 4.5): one component for the
// transaction page and both property layouts. A chip per folder (its own,
// then its property's under "From <property>"), Add folder to find, browse,
// make or paste one, and the open folder below. Old address links show read
// only until the migration moves them over. A client login gets its data
// room (ClientPropertyFoldersPanel, /api/client/sharepoint/) and never calls
// /api/folders/.
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowDown, ArrowUp, ExternalLink, FolderOpen, Loader2, MoreVertical, Pencil, Plus, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { ClientPropertyFoldersPanel } from "@/pages/properties";
import { FOLDER_COLOURS, folderLabel, type FolderLinkView, type FolderRecordRef, type FolderRecordType, type RecordFoldersView } from "@shared/folders";
import { cn } from "@/lib/utils";
import { FolderApiError, folderApi, recordFoldersKey, refreshFolders } from "./folder-api";
import { FolderBrowser } from "./folder-browser";
import { FolderDialog } from "./folder-dialog";
import { RecordFolderPicker } from "./record-folder-picker";

export { RecordFolderPicker } from "./record-folder-picker";

type RecordType = FolderRecordType;
const colourOf = (key: string | null) => FOLDER_COLOURS.find(c => c.key === key) || null;
const recordHref = (r: FolderRecordRef) => r.type === "property" ? `/properties/${r.id}` : r.type === "deal" ? `/deals/${r.id}` : r.type === "company" ? `/companies/${r.id}` : null;

export function RecordFolders(props: {
  recordType: RecordType;
  recordId: string;
  recordName: string;
  /** A client login (or staff viewing as a client): its data room for the property, read only. */
  client?: boolean;
  /** The property whose data room a client sees (a transaction's property). */
  propertyId?: string | null;
  propertyName?: string | null;
  bare?: boolean;
  /** Inside a card already titled Folders: the count and Add folder without a second title. */
  hideTitle?: boolean;
  /** Where room is short (a scheme's row, the brand page's gallery): the chips only; a chip opens its folder in a window. */
  compact?: boolean;
}) {
  if (props.client) {
    const propertyId = props.recordType === "property" ? props.recordId : props.propertyId;
    return propertyId
      ? <ClientPropertyFoldersPanel propertyName={(props.recordType === "property" ? props.recordName : props.propertyName) || ""} propertyId={propertyId} />
      : <p className="text-xs text-muted-foreground italic">Documents are managed by the BGP team.</p>;
  }
  return <StaffRecordFolders {...props} />;
}

function StaffRecordFolders({ recordType, recordId, recordName, propertyId, propertyName, bare, hideTitle, compact }: { recordType: RecordType; recordId: string; recordName: string; propertyId?: string | null; propertyName?: string | null; bare?: boolean; hideTitle?: boolean; compact?: boolean }) {
  const { toast } = useToast();
  const query = useQuery<RecordFoldersView, FolderApiError>({
    queryKey: recordFoldersKey(recordType, recordId),
    queryFn: () => folderApi("GET", `/api/folders/${recordType}/${recordId}`),
    retry: false,
  });
  const view = query.data;
  const own = view?.folders || [];
  const inherited = view?.inherited || [];
  const all = useMemo(() => [...own, ...inherited.flatMap(g => g.folders)], [view]);
  const [openId, setOpenId] = useState<string | null>(null);
  const current = compact ? all.find(f => f.id === openId) || null : all.find(f => f.id === openId) || all.find(f => f.status === "ok" && f.itemId) || all[0] || null;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [relabel, setRelabel] = useState<FolderLinkView | null>(null);
  const [unlink, setUnlink] = useState<FolderLinkView | null>(null);

  const change = async (link: FolderLinkView, patch: Record<string, unknown>, done: string) => {
    try {
      await folderApi("PATCH", `/api/folders/links/${link.id}`, patch);
      await refreshFolders();
      toast({ title: done });
    } catch (e: any) {
      toast({ title: "Not changed", description: e?.message, variant: "destructive" });
    }
  };

  const chip = (f: FolderLinkView, from: FolderRecordRef | null, index: number, count: number) => (
    <span key={f.id} className="inline-flex items-center" data-testid={`folder-chip-${f.legacy ? "legacy" : f.id}`}>
      <Pill active={current?.id === f.id} onClick={() => setOpenId(f.id)} title={f.path || f.webUrl || f.label} className="max-w-[16rem]" data-testid={`folder-chip-open-${f.id}`}>
        {f.status !== "ok" && f.status !== "unknown" ? <AlertTriangle className="w-3 h-3 shrink-0" /> : null}
        {colourOf(f.colour) ? <span className={cn("h-2 w-2 shrink-0 rounded-full", colourOf(f.colour)!.dot)} aria-hidden data-testid={`folder-chip-colour-${f.id}`} /> : null}
        <span className="truncate">{f.label}</span>
        {f.legacy ? <span className="font-normal normal-case opacity-70">· old link</span> : null}
      </Pill>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="ml-0.5 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`${f.label}: more`} data-testid={`folder-chip-menu-${f.id}`}>
            <MoreVertical className="w-3.5 h-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground break-words">{f.path || f.webUrl}</DropdownMenuLabel>
          {f.webUrl && <DropdownMenuItem onClick={() => window.open(f.webUrl!, "_blank", "noopener")}><ExternalLink className="w-3.5 h-3.5 mr-2" />Open in SharePoint</DropdownMenuItem>}
          {f.legacy ? (
            <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">An old link, read only until it is moved into Folders.</DropdownMenuLabel>
          ) : from ? (
            <DropdownMenuItem asChild><Link href={recordHref(from) || "#"}><FolderOpen className="w-3.5 h-3.5 mr-2" />Linked on {from.name}</Link></DropdownMenuItem>
          ) : (
            <>
              <DropdownMenuItem onClick={() => setRelabel(f)} data-testid={`folder-chip-relabel-${f.id}`}><Pencil className="w-3.5 h-3.5 mr-2" />Rename the label</DropdownMenuItem>
              {/* Colour (decision 5): the app's own six, seen in the app only; SharePoint keeps none. */}
              <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">Colour</DropdownMenuLabel>
              <div className="flex flex-wrap items-center gap-1 px-2 pb-1.5" role="group" aria-label="Colour">
                {FOLDER_COLOURS.map(c => (
                  <DropdownMenuItem key={c.key} className={cn("h-6 w-6 justify-center rounded-full p-0", f.colour === c.key && "ring-2 ring-foreground ring-offset-1 ring-offset-popover")} onClick={() => change(f, { colour: c.key }, `${c.label} colour`)} aria-label={c.label} title={c.label} data-testid={`folder-chip-colour-${c.key}-${f.id}`}>
                    <span className={cn("h-3.5 w-3.5 rounded-full", c.dot)} />
                  </DropdownMenuItem>
                ))}
                {f.colour && (
                  <DropdownMenuItem className="h-6 justify-center rounded-full px-2 py-0 text-[11px] text-muted-foreground" onClick={() => change(f, { colour: null }, "No colour")} data-testid={`folder-chip-colour-none-${f.id}`}>None</DropdownMenuItem>
                )}
              </div>
              {index > 0 && <DropdownMenuItem onClick={() => change(f, { position: index - 1 }, "Moved up")} data-testid={`folder-chip-up-${f.id}`}><ArrowUp className="w-3.5 h-3.5 mr-2" />Move up</DropdownMenuItem>}
              {index < count - 1 && <DropdownMenuItem onClick={() => change(f, { position: index + 1 }, "Moved down")} data-testid={`folder-chip-down-${f.id}`}><ArrowDown className="w-3.5 h-3.5 mr-2" />Move down</DropdownMenuItem>}
              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setUnlink(f)} data-testid={`folder-chip-unlink-${f.id}`}><Unlink className="w-3.5 h-3.5 mr-2" />Unlink</DropdownMenuItem>
            </>
          )}
          {f.alsoLinked.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">Also linked to</DropdownMenuLabel>
              {f.alsoLinked.map(r => (
                <DropdownMenuItem key={`${r.type}:${r.id}`} asChild><Link href={recordHref(r) || "#"} data-testid={`folder-chip-also-${r.type}-${r.id}`}>{r.name}</Link></DropdownMenuItem>
              ))}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );

  const ownEngine = own.filter(f => !f.legacy);
  return (
    <div className={bare ? "space-y-3" : "rounded-lg border border-border bg-card p-3 space-y-3"} data-testid="record-folders">
      <div className="flex flex-wrap items-center gap-2">
        {!hideTitle && <h3 className="text-sm font-semibold">Folders</h3>}
        {all.length > 0 && <span className="font-mono tabular-nums text-xs text-muted-foreground">{hideTitle ? `${all.length} folder${all.length === 1 ? "" : "s"}` : all.length}</span>}
        <Button type="button" size="sm" variant="outline" className="ml-auto h-7 text-xs" onClick={() => setPickerOpen(true)} data-testid="folders-add">
          <Plus className="w-3.5 h-3.5 mr-1" />Add folder
        </Button>
      </div>
      {view && !view.connected && (
        <p className="text-xs text-muted-foreground" data-testid="folders-connect">
          To open, add or make folders, connect your own Microsoft 365 on the <Link href="/sharepoint" className="text-primary underline underline-offset-2">SharePoint page</Link>: folder actions run as you.
        </p>
      )}
      {query.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Reading the folders…</div>
      ) : query.error ? (
        <p className="text-sm text-muted-foreground">{query.error.message}</p>
      ) : all.length === 0 && compact ? (
        <p className="text-xs text-muted-foreground" data-testid="folders-empty">No folders yet.</p>
      ) : all.length === 0 ? (
        <div className="py-6 text-center space-y-2" data-testid="folders-empty">
          <FolderOpen className="w-8 h-8 mx-auto text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No folders yet.</p>
          <Button type="button" size="sm" onClick={() => setPickerOpen(true)}><Plus className="w-3.5 h-3.5 mr-1" />Add folder</Button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5" data-testid="folders-strip">
            {own.map(f => chip(f, null, ownEngine.indexOf(f), ownEngine.length))}
            {inherited.map(g => (
              <span key={`${g.from.type}:${g.from.id}`} className="contents">
                <span className="text-[11px] text-muted-foreground ml-1" data-testid="folders-from">From {g.from.name}</span>
                {g.folders.map(f => chip(f, g.from, -1, 0))}
              </span>
            ))}
          </div>
          {current && !compact && <OpenFolder link={current} onUnlink={() => setUnlink(current)} />}
        </>
      )}
      {compact && (
        <FolderDialog open={!!current} onOpenChange={o => { if (!o) setOpenId(null); }} title={current?.label || "Folder"} description={current?.path || undefined} size="lg" testId="folders-open-dialog">
          {current && <OpenFolder link={current} onUnlink={() => setUnlink(current)} />}
        </FolderDialog>
      )}

      <RecordFolderPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        record={{ type: recordType, id: recordId, name: recordName }}
        alt={recordType === "deal" && propertyId ? { type: "property", id: propertyId, name: propertyName || "the property" } : null}
      />
      <LabelDialog link={relabel} onClose={() => setRelabel(null)} onSave={(f, label) => change(f, { label }, "Label changed")} />
      <FolderDialog
        open={!!unlink}
        onOpenChange={o => { if (!o) setUnlink(null); }}
        title={`Unlink ${unlink?.label || "the folder"}?`}
        description="It comes off this record only. The folder and everything in it stay in SharePoint."
        size="sm"
        testId="folders-unlink-dialog"
        footer={<>
          <Button type="button" variant="outline" onClick={() => setUnlink(null)}>Cancel</Button>
          <Button type="button" variant="destructive" data-testid="folders-unlink-confirm" onClick={async () => {
            const f = unlink;
            setUnlink(null);
            if (!f) return;
            try { await folderApi("DELETE", `/api/folders/links/${f.id}`); await refreshFolders(); toast({ title: "Unlinked", description: `${f.label} stays in SharePoint.` }); }
            catch (e: any) { toast({ title: "Not unlinked", description: e?.message, variant: "destructive" }); }
          }}>Unlink</Button>
        </>}
      >
        <p className="text-xs text-muted-foreground break-words">{unlink?.path}</p>
      </FolderDialog>
    </div>
  );
}

function OpenFolder({ link, onUnlink }: { link: FolderLinkView; onUnlink: () => void }) {
  if (link.status === "missing") {
    return (
      <div className="rounded-md border border-border p-3 text-sm space-y-2" data-testid="folders-missing">
        <p>{link.label} isn't in SharePoint any more: it may have been moved or deleted.</p>
        {!link.legacy && <Button type="button" size="sm" variant="outline" onClick={onUnlink}>Unlink it</Button>}
      </div>
    );
  }
  if (link.status === "no_access") {
    return <p className="rounded-md border border-border p-3 text-sm" data-testid="folders-no-access">SharePoint says you can't open {link.label}. Ask whoever owns the folder for access.</p>;
  }
  if (!link.driveId || !link.itemId) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="folders-unread">
        {link.webUrl ? <a href={link.webUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Open {link.label} in SharePoint</a> : link.label}
      </p>
    );
  }
  return <FolderBrowser key={link.id} root={{ driveId: link.driveId, itemId: link.itemId, name: link.label, webUrl: link.webUrl }} />;
}

function LabelDialog({ link, onClose, onSave }: { link: FolderLinkView | null; onClose: () => void; onSave: (f: FolderLinkView, label: string) => Promise<void> }) {
  const [value, setValue] = useState("");
  useEffect(() => { if (link) setValue(link.label); }, [link]);
  const label = folderLabel(value);
  return (
    <FolderDialog
      open={!!link}
      onOpenChange={o => { if (!o) onClose(); }}
      title="Rename the label"
      description="The name on the chip in the app. The folder in SharePoint keeps its own name."
      size="sm"
      testId="folders-label-dialog"
      footer={<>
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="button" disabled={!label} onClick={async () => { const f = link; onClose(); if (f && label) await onSave(f, label); }} data-testid="folders-label-save">Save</Button>
      </>}
    >
      <Input value={value} onChange={e => setValue(e.target.value)} className="h-9 text-sm" autoFocus data-testid="folders-label-input" />
    </FolderDialog>
  );
}
