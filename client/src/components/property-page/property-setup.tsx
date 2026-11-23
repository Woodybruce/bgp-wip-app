// Setting up a property (Woody, 23 November 2026: "when we set up a new
// property should ask before its set up some basic questions I think? correct
// address? then documents where do we want the files options are existing
// folder with a pop out to the BGP share drive and ability to go in and pick a
// folder. or create new folder tree. Add joint agent and tenancy schedule or
// areas schedule for marketing and add brochure and add plans"). One step at a
// time, each one skippable; every step saves through the route the property
// page already uses. Opens after a property is added (?setup=1) and from the
// property page's More menu. Rules: shared/property-setup.ts.
import { useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, ExternalLink, FolderOpen, FolderPlus, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { apiRequest, getAuthHeaders, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { AddressAutocomplete } from "@/components/address-autocomplete";
import { InlineCompetitorAgent, addressToResult, resultToAddress } from "@/pages/properties";
import { PropertyBrochuresPanel } from "@/components/property-brochures-panel";
import { UploadPlanButton } from "@/components/property-plans-panel";
import { PropertyOwnershipCard } from "@/components/property-page/ownership-card";
import { ShareDriveFolderPicker, type PickedFolder } from "@/components/sharepoint-folder-picker";
import { SETUP_STEPS, type SetupStepKey } from "@shared/property-setup";
import type { CrmCompany, CrmProperty } from "@shared/schema";

const plain = (e: unknown) => String((e as any)?.message || e || "").replace(/^\d{3}:\s*/, "").replace(/^\{"(?:message|error)":"(.*)"\}$/, "$1");
const formatted = (address: any): string => (typeof address === "string" ? address : address?.address || address?.formatted || address?.street || "");

function Step({ k, label, summary, done, open, onToggle, children }: { k: SetupStepKey; label: string; summary: string; done: boolean; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className="rounded-md border border-border" data-testid={`setup-step-${k}`}>
      <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left" onClick={onToggle} aria-expanded={open}>
        {done ? <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" /> : <span className="w-4 h-4 shrink-0 rounded-full border border-border" />}
        <span className="text-sm font-semibold w-28 shrink-0">{label}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{open ? "" : summary}</span>
        <ChevronDown className={`w-4 h-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="border-t border-border px-3 py-3 space-y-2">{children}</div>}
    </div>
  );
}

export function PropertySetupDialog({ property, allCompanies, open, onOpenChange }: {
  property: CrmProperty; allCompanies: CrmCompany[]; open: boolean; onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const p = property as any;
  const [openStep, setOpenStep] = useState<SetupStepKey | null>("address");
  const [done, setDone] = useState<Partial<Record<SetupStepKey, boolean>>>({});
  const mark = (k: SetupStepKey) => {
    setDone(d => ({ ...d, [k]: true }));
    const next = SETUP_STEPS[SETUP_STEPS.findIndex(s => s.key === k) + 1];
    setOpenStep(next ? next.key : null);
  };
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/crm/properties", property.id] });
    queryClient.invalidateQueries({ queryKey: ["/api/crm/properties"] });
  };

  // Address: correct it, or confirm it.
  const [changingAddress, setChangingAddress] = useState(false);
  const saveAddress = useMutation({
    mutationFn: async (result: any) => (await apiRequest("PUT", `/api/crm/properties/${property.id}`, {
      address: resultToAddress(result), postcode: result?.postcode || null,
      latitude: result?.lat != null ? String(result.lat) : null, longitude: result?.lng != null ? String(result.lng) : null,
    })).json(),
    onSuccess: () => { refresh(); setChangingAddress(false); toast({ title: "Address saved" }); mark("address"); },
    onError: (e) => toast({ title: "Address not saved", description: plain(e), variant: "destructive" }),
  });

  // Files: an existing folder, or a new folder tree inside one.
  const [picker, setPicker] = useState<"link" | "tree" | null>(null);
  const [template, setTemplate] = useState<string>("");
  const templates = useQuery<Array<{ team: string; folderCount: number; structure: string[] }>>({ queryKey: ["/api/microsoft/folder-templates"], enabled: open && openStep === "files" });
  const linkFolder = useMutation({
    mutationFn: async (f: PickedFolder) => {
      if (!f.webUrl) throw new Error("SharePoint gave no address for that folder.");
      return (await apiRequest("PUT", `/api/crm/properties/${property.id}`, { sharepointFolderUrl: f.webUrl })).json();
    },
    onSuccess: (_r, f) => { refresh(); setPicker(null); toast({ title: "Folder linked", description: f.path || f.name }); mark("files"); },
    onError: (e) => toast({ title: "Folder not linked", description: plain(e), variant: "destructive" }),
  });
  const makeTree = useMutation({
    mutationFn: async (f: PickedFolder) => {
      const structure = (templates.data || []).find(t => t.team === template)?.structure || [];
      return (await apiRequest("POST", `/api/properties/${property.id}/folders/tree`, { driveId: f.driveId, parentId: f.id, structure })).json();
    },
    onSuccess: (r: any, f) => {
      refresh(); setPicker(null);
      toast({ title: "Folders made", description: `${r?.folders || 0} folder${r?.folders === 1 ? "" : "s"} in ${f.path || f.name} / ${r?.name || ""}${r?.errors?.length ? `; ${r.errors.length} not made` : ""}` });
      mark("files");
    },
    onError: (e) => toast({ title: "Folders not made", description: plain(e), variant: "destructive" }),
  });

  // Schedule: a tenancy or areas schedule in Excel, read into the tenancy schedule.
  const scheduleInput = useRef<HTMLInputElement>(null);
  const [scheduleResult, setScheduleResult] = useState<string | null>(null);
  const importSchedule = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      form.append("propertyId", property.id);
      const r = await fetch("/api/tenancy-schedule/import-excel", { method: "POST", headers: getAuthHeaders(), body: form, credentials: "include" });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(out.error || out.message || "The schedule was not read.");
      return out;
    },
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenancy-schedule/property", property.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/properties", property.id, "units"] });
      setScheduleResult(r?.message || `${r?.imported || 0} units read.`);
      mark("schedule");
    },
    onError: (e) => toast({ title: "Schedule not read", description: plain(e), variant: "destructive" }),
  });

  const address = formatted(p.address);
  const summaries: Record<SetupStepKey, string> = {
    address: address ? `${address}${p.postcode && !address.includes(p.postcode) ? `, ${p.postcode}` : ""}` : "No address yet",
    owner: "Who owns it at Land Registry",
    files: p.sharepointFolderUrl ? "Linked to a folder" : "Not linked to a folder",
    agent: p.competitorAgentId || p.competitorAgent ? "Joint agent set" : "No joint agent",
    schedule: scheduleResult || "Tenancy or areas schedule (Excel)",
    brochure: "The marketing brochure (PDF)",
    plans: "Floor plans",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto" data-testid="property-setup-dialog">
        <DialogHeader>
          <DialogTitle>Set up {property.name}</DialogTitle>
          <DialogDescription>Each step can be skipped and done later from the property page.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {SETUP_STEPS.map(({ key, label }) => (
            <Step key={key} k={key} label={label} summary={summaries[key]} done={!!done[key]} open={openStep === key} onToggle={() => setOpenStep(o => (o === key ? null : key))}>
              {key === "address" && (
                <>
                  <p className="text-sm">{address || "No address yet."}{p.postcode && !address.includes(p.postcode) ? `, ${p.postcode}` : ""}</p>
                  {changingAddress ? (
                    <AddressAutocomplete value={p.address ? addressToResult(p.address) : null} onChange={r => { if (r) saveAddress.mutate(r); }} placeholder="Search for the right address..." />
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {address && <Button type="button" size="sm" className="h-7 text-xs" onClick={() => mark("address")} data-testid="setup-address-correct">Correct</Button>}
                      <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => setChangingAddress(true)} data-testid="setup-address-change">{address ? "Change it" : "Add the address"}</Button>
                    </div>
                  )}
                  {saveAddress.isPending && <p className="text-xs text-muted-foreground">Saving…</p>}
                </>
              )}
              {key === "owner" && (
                <>
                  <PropertyOwnershipCard propertyId={property.id} onOpenAml={() => undefined} showAml={false} />
                  <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => mark("owner")}>Next</Button>
                </>
              )}
              {key === "files" && (
                <>
                  {p.sharepointFolderUrl && (
                    <a href={p.sharepointFolderUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline"><ExternalLink className="w-3 h-3" />Open the linked folder</a>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => setPicker("link")} data-testid="setup-files-existing"><FolderOpen className="w-3.5 h-3.5 mr-1" />Pick an existing folder</Button>
                    <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={!template} title={template ? undefined : "Choose the folders to make first"} onClick={() => setPicker("tree")} data-testid="setup-files-new"><FolderPlus className="w-3.5 h-3.5 mr-1" />Create a new folder tree</Button>
                    <select aria-label="Folders to make" className="h-7 rounded border border-border bg-background px-2 text-xs" value={template} onChange={e => setTemplate(e.target.value)} data-testid="setup-files-template">
                      <option value="">Folders to make…</option>
                      {(templates.data || []).map(t => <option key={t.team} value={t.team}>{t.team} ({t.folderCount} folders)</option>)}
                    </select>
                  </div>
                  <ShareDriveFolderPicker open={picker === "link"} onOpenChange={o => setPicker(o ? "link" : null)} title={`The folder for ${property.name}`} onPick={f => linkFolder.mutate(f)} />
                  <ShareDriveFolderPicker open={picker === "tree"} onOpenChange={o => setPicker(o ? "tree" : null)} title={`Where to make ${property.name}'s folders`}
                    description={`A folder called ${property.name} is made in the folder you pick, with the ${template} folders inside it.`} pickLabel="Make them here" onPick={f => makeTree.mutate(f)} />
                  {(linkFolder.isPending || makeTree.isPending) && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="w-3.5 h-3.5 animate-spin" />{makeTree.isPending ? "Making the folders…" : "Linking…"}</p>}
                </>
              )}
              {key === "agent" && (
                <>
                  <div className="text-sm"><InlineCompetitorAgent propertyId={property.id} competitorAgentId={p.competitorAgentId} competitorAgent={p.competitorAgent} allCompanies={allCompanies} /></div>
                  <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => mark("agent")}>Next</Button>
                </>
              )}
              {key === "schedule" && (
                <>
                  <input ref={scheduleInput} type="file" accept=".xlsx,.xlsm,.xls" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) importSchedule.mutate(f); e.target.value = ""; }} data-testid="setup-schedule-file" />
                  <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={importSchedule.isPending} onClick={() => scheduleInput.current?.click()} data-testid="setup-schedule-upload">
                    {importSchedule.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : null}Upload the tenancy or areas schedule (Excel)
                  </Button>
                  {scheduleResult && <p className="text-xs text-muted-foreground">{scheduleResult} Check it on the Tenancy schedule tab.</p>}
                </>
              )}
              {key === "brochure" && (
                <>
                  <PropertyBrochuresPanel propertyId={property.id} />
                  <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => mark("brochure")}>Next</Button>
                </>
              )}
              {key === "plans" && (
                <div className="flex flex-wrap items-center gap-2">
                  <UploadPlanButton propertyId={property.id} canScan onUploaded={() => { queryClient.invalidateQueries({ queryKey: ["/api/properties", property.id, "plans"] }); mark("plans"); }} />
                  <span className="text-xs text-muted-foreground">Each page can be cropped, then it is scanned for the units.</span>
                </div>
              )}
            </Step>
          ))}
        </div>
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)} data-testid="property-setup-done">Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
