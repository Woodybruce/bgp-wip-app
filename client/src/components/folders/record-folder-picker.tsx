// The folder picker wired to a record (docs/folders-review-2026-11-20.md, 4.5):
// link what is ticked, make a new folder where the person is browsing and link
// it, or paste a link. Its own file, so a page can offer it without the rest of
// Folders (the Properties list's Folders column).
import { useEffect, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import type { DriveEntry, FolderLinkView, FolderRecordRef, FolderTemplateKey } from "@shared/folders";
import { folderApi, refreshFolders } from "./folder-api";
import { FolderPicker } from "./folder-picker";

/**
 * The picker wired to a record: link what is ticked (or the folder you are
 * in), make a new folder where you are and link it, or paste a link. A
 * transaction offers a tick to put it on its property instead (decision 4).
 */
export function RecordFolderPicker({ open, onOpenChange, record, alt, startNew, defaultTemplate, title, onDone }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  record: FolderRecordRef;
  alt?: FolderRecordRef | null;
  startNew?: boolean;
  defaultTemplate?: FolderTemplateKey;
  title?: string;
  /** After a folder was linked or made (the property set-up marks its step done). */
  onDone?: () => void;
}) {
  const { toast } = useToast();
  const [onAlt, setOnAlt] = useState(false);
  useEffect(() => { if (open) setOnAlt(false); }, [open]);
  const target = onAlt && alt ? alt : record;
  const linkAll = async (folders: DriveEntry[]) => {
    const failed: string[] = [];
    let linked = 0;
    for (const f of folders) {
      try { await folderApi("POST", `/api/folders/${target.type}/${target.id}/links`, { driveId: f.driveId, itemId: f.itemId }); linked++; }
      catch (e: any) { failed.push(`${f.name}: ${e?.message || "not linked"}`); }
    }
    await refreshFolders();
    if (linked) { toast({ title: `${linked} folder${linked === 1 ? "" : "s"} linked`, description: `On ${target.name}.` }); onDone?.(); }
    if (failed.length) throw new Error(failed.join(" "));
  };
  return (
    <FolderPicker
      open={open}
      onOpenChange={onOpenChange}
      title={title || (startNew ? `New folder for ${target.name}` : `Add a folder to ${target.name}`)}
      description={startNew ? "Choose where it goes, from BGP - Share Drive or your OneDrive, then make it here." : "Find it by name, or browse to it. Tick several to link them together."}
      multiple
      onPick={linkAll}
      onPaste={async url => {
        await folderApi("POST", `/api/folders/${target.type}/${target.id}/links`, { url });
        await refreshFolders();
        toast({ title: "Folder linked", description: `On ${target.name}.` });
        onDone?.();
      }}
      create={{
        defaultName: target.name,
        defaultTemplate: defaultTemplate || (target.type === "property" ? "property" : "empty"),
        startOpen: startNew,
        onCreate: async (where, name, template) => {
          const r = await folderApi<{ link: FolderLinkView; made: number; failed: string[] }>("POST", `/api/folders/${target.type}/${target.id}/create`, { driveId: where.driveId, parentId: where.itemId, name, template });
          await refreshFolders();
          toast({
            title: `${name} made and linked`,
            description: `${r.made} folder${r.made === 1 ? "" : "s"} in ${where.name}${r.failed.length ? `; not made: ${r.failed.join("; ")}` : ""}.`,
          });
          onDone?.();
        },
      }}
      extra={alt ? (
        <label className="flex items-center gap-2 text-xs" data-testid="folders-on-property">
          <Checkbox checked={onAlt} onCheckedChange={v => setOnAlt(v === true)} />
          Put it on {alt.name} instead, so every transaction there shows it
        </label>
      ) : null}
      testId="folder-picker"
    />
  );
}
