// The brief's plans and marketing material (Woody, 2026-11-12): plans of
// the unit and the scheme's plans, the scheme brochure, photos and any other
// file. Unit files are the tracker unit's own files (the same rows as the
// Letting Tracker's Files dialog, so a file deleted here is deleted there);
// the scheme's plans and brochures stay on the property and are only marked
// as being on this brief.
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import PDFViewer from "@/components/pdf-viewer";
import { FileText, FolderOpen, ImageIcon, Loader2, Plus, Trash2, Upload } from "lucide-react";
import { apiRequest, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { BriefBrochureRef, BriefFileRef, BriefPlanRef } from "@shared/unit-brief";
import type { BriefSectionProps } from "./types";

type UnitFileCategory = "floorplan" | "brochure" | "photo" | "other";
type Openable = { id: string; url: string | null; name: string; mimeType?: string | null };

// What the upload route takes (server/routes.ts marketingUpload): PDF, Word,
// Excel, PowerPoint and images, up to 50 MB each.
const IMAGE_TYPES = "image/jpeg,image/png,image/gif,image/webp";
const PLAN_TYPES = `application/pdf,${IMAGE_TYPES}`;
const BROCHURE_TYPES = ".pdf,.doc,.docx,.ppt,.pptx";
const ANY_TYPES = ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.gif,.webp";
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const UPLOAD_NOUN: Record<UnitFileCategory, [string, string]> = {
  floorplan: ["Plan", "plans"],
  brochure: ["Brochure", "brochures"],
  photo: ["Photo", "photos"],
  other: ["File", "files"],
};

const isImageFile = (f: BriefFileRef): boolean => !!f.mimeType?.startsWith("image/");

// The section a unit file sits in, as the tracker's Files dialog reads it:
// an image filed as a brochure is a photo, and a file with no section is a
// brochure.
const sectionOf = (f: BriefFileRef): UnitFileCategory =>
  f.category === "floorplan" || f.category === "photo" || f.category === "other"
    ? f.category
    : isImageFile(f) ? "photo" : "brochure";

const day = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";

const planLabel = (p: BriefPlanRef): string => p.floor?.trim() || "Plan";

const brochureKind = (b: BriefBrochureRef): string =>
  b.type === "investment" ? "Investment brochure" : b.type === "leasing" ? "Leasing brochure" : "Scheme brochure";

async function serverMessage(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null);
  return body?.message || body?.error || fallback;
}

const CHIP = "rounded-full border px-2 py-px text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap";
const SUB_LABEL = "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";

// An image from a signed-in route. The plain request carries the session
// cookie; where only the bearer token is held it is fetched with the token.
function Thumb({ url, alt, className }: { url: string; alt: string; className?: string }) {
  const [src, setSrc] = useState(url);
  const [failed, setFailed] = useState(false);
  const retried = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setSrc(url); setFailed(false); retried.current = false; }, [url]);
  useEffect(() => () => { if (src.startsWith("blob:")) URL.revokeObjectURL(src); }, [src]);

  const retryWithToken = async () => {
    if (retried.current) { setFailed(true); return; }
    retried.current = true;
    try {
      const res = await fetch(url, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error(String(res.status));
      const blobUrl = URL.createObjectURL(await res.blob());
      if (alive.current) setSrc(blobUrl); else URL.revokeObjectURL(blobUrl);
    } catch {
      if (alive.current) setFailed(true);
    }
  };

  if (failed) {
    return (
      <span className={cn("flex items-center justify-center bg-muted text-muted-foreground", className)} role="img" aria-label={alt}>
        <ImageIcon className="h-4 w-4" />
      </span>
    );
  }
  return <img src={src} alt={alt} loading="lazy" onError={retryWithToken} className={className} />;
}

function Section({ title, count, testId, actions, children }: {
  title: string; count: number; testId: string; actions?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="space-y-2 min-w-0" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b pb-1.5">
        <h3 className="text-xs font-semibold uppercase tracking-wider">
          {title} <span className="text-muted-foreground">·</span>{" "}
          <span className="font-mono tabular-nums text-muted-foreground" data-testid={`${testId}-count`}>{count}</span>
        </h3>
        {actions ? <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

function UploadButton({ label, busyLabel, accept, multiple, busy, disabled, primary, testId, onFiles }: {
  label: string; busyLabel: string; accept: string; multiple?: boolean; busy: boolean; disabled: boolean;
  primary?: boolean; testId: string; onFiles: (files: File[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input} type="file" className="hidden" accept={accept} multiple={multiple}
        onChange={e => { const files = Array.from(e.target.files || []); e.target.value = ""; if (files.length) onFiles(files); }}
        data-testid={`${testId}-input`}
      />
      <Button type="button" size="sm" variant={primary ? "default" : "outline"} disabled={disabled} onClick={() => input.current?.click()} data-testid={testId}>
        {busy ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1" />}
        {busy ? busyLabel : label}
      </Button>
    </>
  );
}

function FileRow({ file, opening, onOpen, onDelete }: {
  file: BriefFileRef; opening: boolean; onOpen: () => void; onDelete?: () => void;
}) {
  return (
    <li className="flex items-center gap-1 rounded-lg border bg-card pl-2 pr-1 py-1" data-testid={`brief-file-${file.id}`}>
      <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left group" onClick={onOpen} data-testid={`brief-file-open-${file.id}`}>
        {isImageFile(file) ? (
          <Thumb url={file.url} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />
        ) : (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
            {opening ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
          </span>
        )}
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium group-hover:underline">{file.name}</span>
          {file.createdAt ? <span className="block text-[11px] text-muted-foreground">Added {day(file.createdAt)}</span> : null}
        </span>
      </button>
      {onDelete && (
        <Button type="button" variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-destructive" onClick={onDelete} aria-label={`Delete ${file.name}`} data-testid={`brief-file-delete-${file.id}`}>
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
    </li>
  );
}

export function BriefFilesPanel({ ws, refresh }: BriefSectionProps) {
  const { toast } = useToast();
  const canEdit = ws.viewer.canEditTerms;
  const [upload, setUpload] = useState<{ category: UnitFileCategory; at: number; total: number } | null>(null);
  const [linking, setLinking] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<BriefFileRef | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [preview, setPreview] = useState<{ url: string; name: string; kind: "pdf" | "image" } | null>(null);

  // The ids on the brief. Held apart from `ws` so a second press made before
  // the workspace has been re-read still starts from the list just saved.
  const planIds = useRef<string[]>([]);
  const brochureIds = useRef<string[]>([]);
  useEffect(() => {
    planIds.current = ws.plans.filter(p => p.attached).map(p => p.id);
    brochureIds.current = ws.brochures.filter(b => b.attached).map(b => b.id);
  }, [ws.plans, ws.brochures]);

  const previewUrl = useRef<string | null>(null);
  previewUrl.current = preview?.url || null;
  useEffect(() => () => { if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); }, []);
  const closePreview = () => setPreview(p => { if (p) URL.revokeObjectURL(p.url); return null; });

  const inSection = (c: UnitFileCategory) => ws.files.filter(f => sectionOf(f) === c);
  const unitPlans = inSection("floorplan");
  const unitBrochures = inSection("brochure");
  const photos = inSection("photo");
  const others = inSection("other");
  const attachedPlans = ws.plans.filter(p => p.attached);
  const attachedBrochures = ws.brochures.filter(b => b.attached);
  const spareBrochures = ws.brochures.filter(b => !b.attached);
  // Someone who cannot change the brief sees what is on it, not the rest of
  // the scheme's plans.
  const schemePlans = canEdit ? [...attachedPlans, ...ws.plans.filter(p => !p.attached)] : attachedPlans;

  // Opened inside the app, as the tracker's Files dialog does: a PDF in the
  // viewer, an image full size, anything else as a download.
  const openItem = async (item: Openable) => {
    if (!item.url || opening) return;
    setOpening(item.id);
    try {
      const res = await fetch(item.url, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error(await serverMessage(res, `The server answered ${res.status}`));
      const blob = await res.blob();
      const type = blob.type || item.mimeType || "";
      const url = URL.createObjectURL(blob);
      if (type.includes("pdf") || type.startsWith("image/")) {
        setPreview(p => { if (p) URL.revokeObjectURL(p.url); return { url, name: item.name, kind: type.includes("pdf") ? "pdf" : "image" }; });
      } else {
        const a = document.createElement("a");
        a.href = url;
        a.download = item.name || "download";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
      }
    } catch (e) {
      toast({ title: "The file could not be opened", description: (e as Error).message, variant: "destructive" });
    } finally {
      setOpening(null);
    }
  };

  const uploadFiles = async (list: File[], category: UnitFileCategory) => {
    if (!list.length || upload) return;
    const failed: { name: string; why: string }[] = [];
    let done = 0;
    let pdfBrochure = false;
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      setUpload({ category, at: i + 1, total: list.length });
      try {
        if (file.size > MAX_UPLOAD_BYTES) throw new Error("The file is larger than 50 MB.");
        const body = new FormData();
        body.append("file", file);
        body.append("category", category);
        const res = await fetch(`/api/available-units/${ws.unit.id}/files`, { method: "POST", credentials: "include", headers: getAuthHeaders(), body });
        if (!res.ok) throw new Error(await serverMessage(res, "The file could not be uploaded."));
        done++;
        if (category === "brochure" && /pdf/i.test(file.type || file.name)) pdfBrochure = true;
      } catch (e) {
        failed.push({ name: file.name, why: (e as Error).message });
      }
    }
    setUpload(null);
    if (done) {
      refresh();
      // The server pulls the photos and plans out of a brochure PDF after it
      // answers, so read the files once more when that has had time to run.
      if (pdfBrochure) setTimeout(refresh, 6000);
    }
    const [one, many] = UPLOAD_NOUN[category];
    if (!failed.length) {
      toast({ title: done === 1 ? `${one} uploaded` : `${done} ${many} uploaded` });
    } else {
      toast({
        title: list.length === 1 ? "Not uploaded" : `${done} of ${list.length} ${many} uploaded`,
        description: list.length === 1 ? failed[0].why : failed.map(f => `${f.name}: ${f.why}`).join(" "),
        variant: "destructive",
      });
    }
  };

  const setOnBrief = async (kind: "plan" | "brochure", id: string, on: boolean) => {
    if (linking) return;
    const held = kind === "plan" ? planIds : brochureIds;
    const next = on ? Array.from(new Set([...held.current, id])) : held.current.filter(x => x !== id);
    setLinking(id);
    try {
      await apiRequest("PATCH", `/api/unit-briefs/${ws.brief.id}`, kind === "plan" ? { planIds: next } : { brochureIds: next });
      held.current = next;
      refresh();
    } catch (e) {
      toast({ title: on ? "Not added to the brief" : "Not removed from the brief", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLinking(null);
    }
  };

  const confirmDelete = async () => {
    if (!toDelete || deleting) return;
    setDeleting(true);
    try {
      await apiRequest("DELETE", `/api/available-units/files/${toDelete.id}`);
      refresh();
      toast({ title: "File deleted" });
      setToDelete(null);
    } catch (e) {
      toast({ title: "Not deleted", description: (e as Error).message, variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  const uploading = (c: UnitFileCategory) => upload?.category === c;
  const progress = upload && upload.total > 1 ? `Uploading ${upload.at} of ${upload.total}` : "Uploading…";
  const planUpload = (primary?: boolean) => (
    <UploadButton label="Upload a plan" busyLabel={progress} accept={PLAN_TYPES} multiple busy={uploading("floorplan")} disabled={!!upload} primary={primary} testId="brief-upload-plan" onFiles={f => uploadFiles(f, "floorplan")} />
  );
  const brochureUpload = (
    <UploadButton label="Upload a brochure for this unit" busyLabel={progress} accept={BROCHURE_TYPES} busy={uploading("brochure")} disabled={!!upload} testId="brief-upload-brochure" onFiles={f => uploadFiles(f, "brochure")} />
  );
  const photoUpload = (
    <UploadButton label="Add photos" busyLabel={progress} accept={IMAGE_TYPES} multiple busy={uploading("photo")} disabled={!!upload} testId="brief-upload-photos" onFiles={f => uploadFiles(f, "photo")} />
  );
  const otherUpload = (
    <UploadButton label="Add a file" busyLabel={progress} accept={ANY_TYPES} multiple busy={uploading("other")} disabled={!!upload} testId="brief-upload-other" onFiles={f => uploadFiles(f, "other")} />
  );
  const fileRows = (files: BriefFileRef[], testId: string) => (
    <ul className="space-y-1.5" data-testid={testId}>
      {files.map(f => (
        <FileRow key={f.id} file={f} opening={opening === f.id} onOpen={() => openItem(f)} onDelete={canEdit ? () => setToDelete(f) : undefined} />
      ))}
    </ul>
  );
  const none = (text: string, testId: string) => <p className="text-sm text-muted-foreground" data-testid={testId}>{text}</p>;

  const brochureNote = !canEdit
    ? (attachedBrochures.length === 0 && unitBrochures.length === 0 ? "No brochure has been added to the brief." : null)
    : ws.brochures.length === 0
      ? (unitBrochures.length === 0 ? "No brochure is filed on this scheme yet. Upload a brochure for this unit instead." : "No brochure is filed on this scheme yet.")
      : attachedBrochures.length === 0
        ? (unitBrochures.length === 0 ? "No brochure on the brief yet. Add the scheme brochure, or upload one for this unit." : "The scheme brochure is not on the brief yet.")
        : null;

  const nothingToShow = ws.files.length === 0 && (canEdit ? ws.plans.length === 0 && ws.brochures.length === 0 : attachedPlans.length === 0 && attachedBrochures.length === 0);

  return (
    <div className="space-y-5 min-w-0" data-testid="brief-files">
      {nothingToShow ? (
        <div className="rounded-lg border border-dashed px-4 py-6 text-center" data-testid="brief-files-empty">
          <FolderOpen className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            {canEdit
              ? "No plans or marketing files yet. Add the unit's plan, the scheme brochure and photos so everyone agreeing the brief sees the same material."
              : "No plans or marketing files have been added to this brief yet."}
          </p>
          {canEdit && (
            <div className="mt-3 flex flex-wrap justify-center gap-1.5">
              {planUpload(true)}
              {brochureUpload}
              {photoUpload}
              {otherUpload}
            </div>
          )}
        </div>
      ) : (
        <>
          <Section title="Plans" count={unitPlans.length + attachedPlans.length} testId="brief-plans" actions={canEdit ? planUpload() : undefined}>
            <p className={SUB_LABEL}>Plans of the unit</p>
            {unitPlans.length > 0
              ? fileRows(unitPlans, "brief-unit-plans")
              : none(canEdit ? "No plan of the unit yet. Upload one, or add one of the scheme's plans below." : "No plan of the unit has been added.", "brief-unit-plans-empty")}
            <p className={cn(SUB_LABEL, "pt-1")}>From the scheme's plans</p>
            {schemePlans.length === 0 ? (
              none(canEdit ? "No plans are filed on this scheme yet." : "No scheme plan has been added to the brief.", "brief-scheme-plans-empty")
            ) : (
              <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2" data-testid="brief-scheme-plans">
                {schemePlans.map(p => (
                  <li key={p.id} className="relative flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card" data-testid={`brief-plan-${p.id}`} data-attached={p.attached ? "true" : "false"}>
                    <button type="button" className="block aspect-[4/3] w-full bg-muted/40" onClick={() => openItem({ id: p.id, url: p.imageUrl, name: `${planLabel(p)} plan`, mimeType: "image/png" })} aria-label={`Open the ${planLabel(p)} plan`} data-testid={`brief-plan-open-${p.id}`}>
                      <Thumb url={p.imageUrl} alt={`${planLabel(p)} plan`} className="h-full w-full object-contain" />
                    </button>
                    {p.attached && (
                      <span className={cn(CHIP, "absolute left-1.5 top-1.5 bg-background border-emerald-600/60 text-emerald-700 dark:text-emerald-400")} data-testid={`brief-plan-on-${p.id}`}>On the brief</span>
                    )}
                    <div className="space-y-1.5 p-2">
                      <p className="truncate text-sm font-medium">{planLabel(p)}</p>
                      {canEdit && (
                        <Button type="button" size="sm" variant="outline" className="w-full" disabled={!!linking} onClick={() => setOnBrief("plan", p.id, !p.attached)} data-testid={`brief-plan-toggle-${p.id}`}>
                          {linking === p.id ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
                          {p.attached ? "Remove from brief" : "Add to brief"}
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            title="Scheme brochure" count={attachedBrochures.length + unitBrochures.length} testId="brief-brochures"
            actions={canEdit ? (
              <>
                {ws.brochures.length > 0 && (
                  <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                    <PopoverTrigger asChild>
                      <Button type="button" size="sm" variant="outline" disabled={!!linking} data-testid="brief-add-scheme-brochure">
                        <Plus className="h-3.5 w-3.5 mr-1" /> Add scheme brochure
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-[min(20rem,calc(100vw-2rem))] p-1.5" data-testid="brief-scheme-brochure-picker">
                      {spareBrochures.length === 0 ? (
                        <p className="p-2 text-xs text-muted-foreground">Every brochure filed on this scheme is already on the brief.</p>
                      ) : (
                        <ul className="max-h-64 space-y-0.5 overflow-y-auto">
                          {spareBrochures.map(b => (
                            <li key={b.id}>
                              <button type="button" className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted" onClick={() => { setPickerOpen(false); setOnBrief("brochure", b.id, true); }} data-testid={`brief-brochure-pick-${b.id}`}>
                                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                                <span className="min-w-0">
                                  <span className="block truncate text-sm font-medium">{b.name}</span>
                                  <span className="block text-[11px] text-muted-foreground">{brochureKind(b)}</span>
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </PopoverContent>
                  </Popover>
                )}
                {brochureUpload}
              </>
            ) : undefined}
          >
            {attachedBrochures.length > 0 && (
              <ul className="space-y-1.5" data-testid="brief-scheme-brochures">
                {attachedBrochures.map(b => (
                  <li key={b.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border bg-card pl-2 pr-1 py-1" data-testid={`brief-brochure-${b.id}`}>
                    <button type="button" className="flex min-w-0 grow basis-full sm:basis-40 items-center gap-2 text-left group" disabled={!b.url} onClick={() => openItem({ id: b.id, url: b.url, name: b.name, mimeType: "application/pdf" })} data-testid={`brief-brochure-open-${b.id}`}>
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
                        {opening === b.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium group-hover:underline">{b.name}</span>
                        <span className="block text-[11px] text-muted-foreground">{brochureKind(b)}, from the scheme</span>
                      </span>
                    </button>
                    {canEdit && (
                      <Button type="button" size="sm" variant="ghost" className="ml-auto shrink-0 text-muted-foreground" disabled={!!linking} onClick={() => setOnBrief("brochure", b.id, false)} data-testid={`brief-brochure-remove-${b.id}`}>
                        {linking === b.id ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
                        Remove from brief
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {brochureNote && none(brochureNote, "brief-brochures-note")}
            {unitBrochures.length > 0 && (
              <>
                <p className={cn(SUB_LABEL, "pt-1")}>For this unit</p>
                {fileRows(unitBrochures, "brief-unit-brochures")}
              </>
            )}
          </Section>

          <Section title="Photos" count={photos.length} testId="brief-photos" actions={canEdit ? photoUpload : undefined}>
            {photos.length === 0 ? (
              none(canEdit ? "No photos yet. Add photos of the unit." : "No photos have been added.", "brief-photos-empty")
            ) : (
              <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2" data-testid="brief-photo-grid">
                {photos.map(f => (
                  <li key={f.id} className="relative min-w-0 overflow-hidden rounded-lg border bg-muted/40" data-testid={`brief-photo-${f.id}`}>
                    <button type="button" className="block aspect-[4/3] w-full" onClick={() => openItem(f)} aria-label={`Open ${f.name}`} title={f.name} data-testid={`brief-photo-open-${f.id}`}>
                      <Thumb url={f.url} alt={f.name} className="h-full w-full object-cover" />
                    </button>
                    {canEdit && (
                      <button type="button" className="absolute right-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-full border bg-background/90 text-foreground shadow-sm hover:text-destructive" onClick={() => setToDelete(f)} aria-label={`Delete ${f.name}`} data-testid={`brief-file-delete-${f.id}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Other files" count={others.length} testId="brief-other-files" actions={canEdit ? otherUpload : undefined}>
            {others.length > 0
              ? fileRows(others, "brief-other-list")
              : none(canEdit ? "No other files yet. Add anything else people need to see, such as a specification or a survey." : "No other files have been added.", "brief-other-empty")}
          </Section>
        </>
      )}

      <AlertDialog open={!!toDelete} onOpenChange={v => { if (!v && !deleting) setToDelete(null); }}>
        <AlertDialogContent data-testid="brief-file-delete-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle className="break-words">Delete {toDelete?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The file is removed from this unit everywhere it shows, including the Letting Tracker. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting} data-testid="brief-file-delete-cancel">Keep the file</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={deleting} onClick={e => { e.preventDefault(); confirmDelete(); }} data-testid="brief-file-delete-yes">
              {deleting ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
              {deleting ? "Deleting…" : "Delete file"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PDFViewer
        url={preview?.kind === "pdf" ? preview.url : ""}
        fileName={preview?.name || "File"}
        open={preview?.kind === "pdf"}
        onClose={closePreview}
        propertyName={ws.unit.propertyName || undefined}
      />

      <Dialog open={preview?.kind === "image"} onOpenChange={v => { if (!v) closePreview(); }}>
        <DialogContent className="max-w-full sm:max-w-[90vw] xl:max-w-[1200px] w-full p-0 gap-0" aria-describedby={undefined} data-testid="brief-image-preview">
          <DialogHeader className="px-4 py-3 border-b" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
            <DialogTitle className="text-sm font-medium truncate pr-8">{preview?.name}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[80dvh] overflow-auto bg-muted/30 flex items-center justify-center p-2">
            {preview?.kind === "image" && (
              <img src={preview.url} alt={preview.name} className="max-w-full max-h-[76dvh] object-contain rounded" />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
