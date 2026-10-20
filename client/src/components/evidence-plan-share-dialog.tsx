import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, ExternalLink, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import type { EvidencePlanShare, EvidencePlanShareResponse, EvidencePlanShareSettings } from "@shared/evidence-plan-sharing";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type ShareableEntry = {
  id: string; unit_ref: string | null; tenant: string | null;
  transaction_type: string | null; transaction_date: string | null;
  headline_rent: string | number | null; source_key: string | null;
};

const sorted = (values: Iterable<string>) => [...values].sort();
const comparable = (settings: EvidencePlanShareSettings) => JSON.stringify({
  label: settings.label.trim(), entryIds: sorted(settings.entryIds),
  documentEntryIds: sorted(settings.documentEntryIds), includeUnitFacts: settings.includeUnitFacts,
});

export function EvidencePlanShareDialog({ planId, planName, entries, open, onOpenChange }: {
  planId: string; planName: string; entries: ShareableEntry[];
  open: boolean; onOpenChange: (open: boolean) => void;
}) {
  const [share, setShare] = useState<EvidencePlanShare | null>(null);
  const [label, setLabel] = useState("");
  const [entryIds, setEntryIds] = useState<Set<string>>(new Set());
  const [documentIds, setDocumentIds] = useState<Set<string>>(new Set());
  const [includeUnitFacts, setIncludeUnitFacts] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState<"save" | "revoke" | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [reload, setReload] = useState(0);
  const requestVersion = useRef(0);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const linkInput = useRef<HTMLInputElement>(null);
  const endpoint = `/api/evidence-plans/${encodeURIComponent(planId)}/share`;

  const applyShare = (next: EvidencePlanShare | null) => {
    setShare(next);
    const active = next && !next.revokedAt ? next : null;
    const available = new Map(entriesRef.current.map(entry => [entry.id, entry]));
    const selected = new Set((active?.entryIds ?? []).filter(id => available.has(id)));
    setLabel(active?.label ?? "");
    setEntryIds(selected);
    setDocumentIds(new Set((active?.documentEntryIds ?? []).filter(id => selected.has(id) && !!available.get(id)?.source_key)));
    setIncludeUnitFacts(active?.includeUnitFacts ?? false);
    setConfirmRevoke(false);
  };

  useEffect(() => {
    const version = ++requestVersion.current;
    if (!open) { applyShare(null); return; }
    setLoading(true); setLoaded(false); setConflict(false); setError(""); setMessage(""); setBusy(null);
    setSearch(""); setSelectedOnly(false); applyShare(null);
    void apiRequest("GET", endpoint).then(response => response.json()).then((result: EvidencePlanShareResponse) => {
      if (version !== requestVersion.current) return;
      applyShare(result.share); setLoaded(true);
    }).catch((reason: Error) => {
      if (version === requestVersion.current) setError(reason.message || "Could not load sharing settings.");
    }).finally(() => {
      if (version === requestVersion.current) setLoading(false);
    });
    return () => { requestVersion.current++; };
  }, [open, endpoint, reload]);

  const availableEntries = useMemo(() => new Map(entries.map(entry => [entry.id, entry])), [entries]);
  const settings: EvidencePlanShareSettings = {
    label: label.trim(),
    entryIds: sorted(entryIds).filter(id => availableEntries.has(id)),
    documentEntryIds: sorted(documentIds).filter(id => entryIds.has(id) && !!availableEntries.get(id)?.source_key),
    includeUnitFacts,
  };
  const activeShare = share && !share.revokedAt ? share : null;
  const expectedShare = activeShare ? { id: activeShare.id, updatedAt: activeShare.updatedAt } : null;
  const dirty = !!activeShare && comparable(settings) !== comparable(activeShare);
  const link = activeShare && typeof window !== "undefined"
    ? `${window.location.origin}/evidence-plan-share/${encodeURIComponent(activeShare.token)}` : "";
  const visibleEntries = entries.filter(entry => (!selectedOnly || entryIds.has(entry.id))
    && `${entry.unit_ref ?? ""} ${entry.tenant ?? ""} ${entry.transaction_type ?? ""} ${entry.transaction_date ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()));

  const selectEntry = (id: string, checked: boolean) => {
    setEntryIds(current => { const next = new Set(current); checked ? next.add(id) : next.delete(id); return next; });
    if (!checked) setDocumentIds(current => { const next = new Set(current); next.delete(id); return next; });
    setMessage("");
  };

  const mutationError = (reason: unknown, fallback: string) => {
    if (reason instanceof Error && /^409:/.test(reason.message)) {
      applyShare(null);
      setLoaded(false);
      setConflict(true);
      setError("Sharing changed in another window. Your action was not applied. Reload the current settings and review them before making changes.");
    } else {
      setError(reason instanceof Error ? reason.message : fallback);
    }
  };

  const save = async () => {
    const version = requestVersion.current;
    setBusy("save"); setError(""); setMessage("");
    try {
      const response = await apiRequest("PUT", endpoint, { ...settings, expectedShare });
      const result: EvidencePlanShareResponse = await response.json();
      if (version !== requestVersion.current) return;
      if (!result.share || result.share.revokedAt) throw new Error("The sharing link could not be confirmed. Refresh the settings and try again.");
      applyShare(result.share);
      setMessage(activeShare ? "Sharing settings saved. The existing link now shows this selection." : "Client link created. Copy or preview it below.");
    } catch (reason) {
      if (version === requestVersion.current) mutationError(reason, "Could not save the sharing settings.");
    } finally { if (version === requestVersion.current) setBusy(null); }
  };

  const revoke = async () => {
    const version = requestVersion.current;
    setBusy("revoke"); setError(""); setMessage("");
    try {
      const response = await apiRequest("POST", `${endpoint}/revoke`, { expectedShare });
      const result: EvidencePlanShareResponse = await response.json();
      if (version !== requestVersion.current) return;
      applyShare(result.share);
      setMessage("Link revoked. Clients can no longer use it. Creating another link will use a new address.");
    } catch (reason) {
      if (version === requestVersion.current) mutationError(reason, "Could not revoke the link.");
    } finally { if (version === requestVersion.current) setBusy(null); }
  };

  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(link);
      setMessage("Client link copied.");
    } catch {
      linkInput.current?.focus(); linkInput.current?.select();
      setMessage("Select and copy the link from the field below.");
    }
  };

  return <Dialog open={open} onOpenChange={next => { if (!busy) onOpenChange(next); }}>
    <DialogContent className="max-w-3xl max-h-[90dvh] overflow-y-auto" data-testid="evidence-plan-share-dialog">
      <DialogHeader>
        <DialogTitle>Share with client</DialogTitle>
        <DialogDescription>{planName} · choose what this read-only link includes.</DialogDescription>
      </DialogHeader>
      <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm">
        <p className="flex items-start gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /><span>Plan images, unit references and tenant names are visible. Only selected evidence and source documents are shared. Internal notes are excluded.</span></p>
        <p className="mt-2 text-muted-foreground">New evidence is not added automatically. Anyone with the link can view the shared content until you revoke it.</p>
      </div>
      {error && <p role="alert" className="rounded-md border border-destructive/30 p-3 text-sm text-destructive">{error}</p>}
      {message && <p role="status" className="text-sm">{message}</p>}
      {loading ? <p role="status" className="flex items-center gap-2 py-8 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Loading sharing settings…</p> : !loaded ? (
        <Button variant="outline" onClick={() => setReload(value => value + 1)} data-testid="reload-evidence-plan-share"><RefreshCw />{conflict ? "Reload current settings" : "Retry"}</Button>
      ) : <>
        <label className="block text-sm font-medium">Client label (optional)
          <Input className="mt-2" value={label} maxLength={160} onChange={event => setLabel(event.target.value)} placeholder="e.g. Client review — October" disabled={!!busy} data-testid="share-client-label" />
          <span className="mt-1 block text-xs font-normal text-muted-foreground">For your reference here; this label is not shown on the client page.</span>
        </label>
        <label className="flex min-h-11 items-start gap-3 rounded-lg border border-border p-3 text-sm">
          <input type="checkbox" checked={includeUnitFacts} onChange={event => setIncludeUnitFacts(event.target.checked)} disabled={!!busy} className="mt-1 h-4 w-4 shrink-0 accent-primary" data-testid="share-unit-facts" />
          <span><span className="block font-medium">Include unit lease facts</span><span className="text-muted-foreground">Share lease dates, rent, area and Landlord &amp; Tenant Act information for all units. Off by default.</span></span>
        </label>
        <section aria-labelledby="share-evidence-heading">
          <h3 id="share-evidence-heading" className="text-sm font-semibold">Evidence to share</h3>
          <p className="mt-1 text-xs text-muted-foreground">{settings.entryIds.length} selected · {settings.documentEntryIds.length} source documents selected</p>
          <div className="my-3 flex flex-wrap items-center gap-3">
            <Input className="min-w-0 flex-1" aria-label="Find evidence to share" placeholder="Find unit, tenant or transaction…" value={search} onChange={event => setSearch(event.target.value)} />
            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={selectedOnly} onChange={event => setSelectedOnly(event.target.checked)} /> Selected only</label>
          </div>
          <div className="max-h-[38dvh] overflow-y-auto rounded-lg border border-border divide-y divide-border">
            {visibleEntries.map(entry => <div key={entry.id} className="p-3" data-testid={`share-entry-${entry.id}`}>
              <label className="flex min-h-11 items-start gap-3 text-sm">
                <input type="checkbox" checked={entryIds.has(entry.id)} onChange={event => selectEntry(entry.id, event.target.checked)} disabled={!!busy} className="mt-1 h-4 w-4 shrink-0 accent-primary" data-testid={`share-entry-checkbox-${entry.id}`} />
                <span className="min-w-0 break-words"><span className="block font-medium">{entry.unit_ref || "Unlinked evidence"}{entry.tenant ? ` · ${entry.tenant}` : ""}</span><span className="block text-xs text-muted-foreground">{[entry.transaction_type, entry.transaction_date].filter(Boolean).join(" · ") || "Transaction details not entered"}{entry.headline_rent !== null && entry.headline_rent !== "" && Number.isFinite(Number(entry.headline_rent)) ? ` · £${Number(entry.headline_rent).toLocaleString("en-GB")}` : ""}</span></span>
              </label>
              {entry.source_key ? <label className="ml-7 flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" checked={entryIds.has(entry.id) && documentIds.has(entry.id)} disabled={!entryIds.has(entry.id) || !!busy} onChange={event => setDocumentIds(current => { const next = new Set(current); event.target.checked ? next.add(entry.id) : next.delete(entry.id); return next; })} className="h-4 w-4 shrink-0 accent-primary" data-testid={`share-document-checkbox-${entry.id}`} /> Include this source document
              </label> : <p className="ml-7 text-xs text-muted-foreground">No source document attached</p>}
            </div>)}
            {!visibleEntries.length && <p className="p-4 text-sm text-muted-foreground">{entries.length ? "No evidence matches this view." : "No evidence has been added. A link can still show the plan and unit names."}</p>}
          </div>
        </section>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <Button variant="outline" disabled={!!busy || dirty} onClick={() => setReload(value => value + 1)}><RefreshCw /> Refresh saved settings</Button>
          <Button onClick={save} disabled={!!busy || (!!activeShare && !dirty)} data-testid="save-evidence-plan-share">{busy === "save" && <Loader2 className="animate-spin" />}{activeShare ? "Save sharing settings" : "Create client link"}</Button>
        </div>
        {activeShare && <section className="space-y-3 rounded-xl border border-border p-4" aria-label="Client link">
          <p className="text-sm font-semibold">Client link {dirty && <span className="ml-2 font-normal text-amber-700">· unsaved changes</span>}</p>
          <Input ref={linkInput} aria-label="Client sharing link" value={link} readOnly onFocus={event => event.currentTarget.select()} className="font-mono text-xs" data-testid="evidence-plan-share-link" />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={copy} disabled={!!busy || dirty} data-testid="copy-evidence-plan-share"><Copy /> Copy link</Button>
            {!dirty && !busy ? <Button variant="outline" asChild><a href={link} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" data-testid="preview-evidence-plan-share"><ExternalLink /> Preview client view</a></Button> : <Button variant="outline" disabled><ExternalLink /> Preview client view</Button>}
            <Button variant="outline" className="text-destructive" onClick={() => setConfirmRevoke(true)} disabled={!!busy} data-testid="revoke-evidence-plan-share">Revoke link</Button>
          </div>
          {dirty && <p className="text-xs text-muted-foreground">Save your changes before copying or previewing. The current link still shows the last saved selection.</p>}
          {confirmRevoke && <div className="border-t border-border pt-3"><p className="text-sm">Revoke this link now? Anyone using it will lose access.</p><div className="mt-3 flex flex-wrap gap-2"><Button variant="destructive" onClick={revoke} disabled={!!busy} data-testid="confirm-revoke-evidence-plan-share">{busy === "revoke" && <Loader2 className="animate-spin" />}Revoke access</Button><Button variant="outline" onClick={() => setConfirmRevoke(false)} disabled={!!busy}>Keep link</Button></div></div>}
        </section>}
        {share?.revokedAt && <p className="text-sm text-muted-foreground">The previous link has been revoked. Select the content to create a new link.</p>}
      </>}
    </DialogContent>
  </Dialog>;
}
