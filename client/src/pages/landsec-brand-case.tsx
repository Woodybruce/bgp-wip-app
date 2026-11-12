// One Landsec brand case (docs/landsec-pitch-plan.md, item 5): the UK
// evidence for a rollout brand — store photos, video, links — a covenant
// summary, the proposed Landsec units, and every asset manager's response
// (seen / supportive / concerns / wants a store visit). BGP writes it;
// Landsec logins read it and record where they stand.
import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { ExternalLink, FileText, Pencil, Play, Trash2, Upload } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { CovenantBadgeByCompany } from "@/components/covenant-badge";
import { apiRequest, queryClient, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { LANDSEC_CASE_RESPONSES, type LandsecCaseEvidence, type LandsecCaseUnit, type LandsecCaseResponse } from "@shared/landsec";

interface Resp { id: string; userId: string; userName: string | null; userRole: string | null; response: string; note: string | null; at: string }
interface CaseData {
  case: {
    id: string; companyId: string; headline: string | null; ukStory: string | null; covenantSummary: string | null;
    evidence: LandsecCaseEvidence[]; proposedUnits: (LandsecCaseUnit & { schemeName: string; unitStatus: string | null; unitTenant: string | null })[];
    status: string; sentAt: string | null; updatedAt: string | null; updatedByName: string | null;
    brand: { name: string; logoUrl: string | null; website: string | null; companyType: string | null; description: string | null; conceptPitch: string | null; storeCount: number | null; rolloutStatus: string | null; backers: string | null; ukEntityName: string | null; companiesHouseNumber: string | null; kycStatus?: string | null; amlRiskLevel?: string | null };
    responses: Resp[]; tally: Record<string, number>;
  } | null;
  brand: { id: string; name: string; logoUrl: string | null };
  myResponse: Resp | null;
  canEdit: boolean;
  schemes: { key: string; name: string }[];
}

const fmtDate = (d: string | null | undefined) => d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";

export default function LandsecBrandCase() {
  const { companyId } = useParams<{ companyId: string }>();
  const { toast } = useToast();
  const queryKey = [`/api/landsec/brand-case/${companyId}`];
  const { data, isLoading, error } = useQuery<CaseData>({ queryKey, staleTime: 30 * 1000 });
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState("");
  const [role, setRole] = useState("");
  const invalidate = () => { queryClient.invalidateQueries({ queryKey }); queryClient.invalidateQueries({ queryKey: ["/api/landsec/brand-cases"] }); };

  const save = useMutation({
    mutationFn: async (body: Record<string, any>) => (await apiRequest("PUT", `/api/landsec/brand-case/${companyId}`, body)).json(),
    onSuccess: () => { invalidate(); setEditing(false); },
    onError: (e: any) => toast({ title: "Not saved", description: e?.message, variant: "destructive" }),
  });
  const respond = useMutation({
    mutationFn: async (body: { response: LandsecCaseResponse; note?: string; role?: string }) => (await apiRequest("POST", `/api/landsec/brand-case/${companyId}/respond`, body)).json(),
    onSuccess: () => { invalidate(); toast({ title: "Response recorded" }); },
    onError: (e: any) => toast({ title: "Not recorded", description: e?.message, variant: "destructive" }),
  });
  const removeEvidence = useMutation({
    mutationFn: async (itemId: string) => (await apiRequest("DELETE", `/api/landsec/brand-case/${companyId}/evidence/${itemId}`)).json(),
    onSuccess: invalidate,
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const uploadFile = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const res = await fetch(`/api/landsec/brand-case/${companyId}/evidence`, { method: "POST", body: fd, credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`);
      invalidate();
    } catch (e: any) { toast({ title: "Upload failed", description: e?.message, variant: "destructive" }); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  useEffect(() => { if (data?.myResponse) { setNote(data.myResponse.note || ""); setRole(data.myResponse.userRole || ""); } }, [data?.myResponse]);

  if (error) return <div className="p-4 md:p-6"><p className="text-sm text-muted-foreground">This brand case could not be opened. {(error as any)?.message || ""}</p></div>;
  if (isLoading || !data) return <div className="p-4 md:p-6 space-y-3"><Skeleton className="h-10 w-80" /><Skeleton className="h-64 rounded-lg" /></div>;

  const c = data.case;
  const photos = c?.evidence.filter(e => e.kind === "photo") || [];
  const videos = c?.evidence.filter(e => e.kind === "video") || [];
  const links = c?.evidence.filter(e => e.kind === "link" || e.kind === "file") || [];

  return (
    <div className="p-4 md:p-6 space-y-4" data-testid="landsec-brand-case">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {data.brand.logoUrl ? <img src={data.brand.logoUrl} alt="" className="w-12 h-12 rounded object-contain bg-white border shrink-0" /> : <div className="w-12 h-12 rounded bg-muted shrink-0" />}
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground"><Link href="/landsec/brand-cases" className="hover:text-foreground">Brand cases</Link></p>
            <h1 className="text-2xl font-bold tracking-tight truncate">{data.brand.name}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{c ? (c.status === "sent" ? `Sent to asset managers ${fmtDate(c.sentAt)}` : "Draft — not yet sent") : "No case written yet"}{c?.brand.storeCount ? ` · ${c.brand.storeCount} stores` : ""}{c?.brand.rolloutStatus ? ` · ${c.brand.rolloutStatus}` : ""}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/companies/${companyId}`}><Button variant="outline" size="sm">Brand profile</Button></Link>
          {data.canEdit && !editing && <Button size="sm" onClick={() => setEditing(true)} data-testid="landsec-brand-case-edit"><Pencil className="w-3.5 h-3.5 mr-1" /> {c ? "Edit case" : "Write the case"}</Button>}
          {data.canEdit && c && !editing && (c.status === "sent"
            ? <Button variant="outline" size="sm" onClick={() => save.mutate({ status: "draft" })}>Back to draft</Button>
            : <Button variant="outline" size="sm" onClick={() => save.mutate({ status: "sent" })} data-testid="landsec-brand-case-send">Mark as sent</Button>)}
        </div>
      </div>

      {editing && data.canEdit && <CaseEditor initial={c} schemes={data.schemes} saving={save.isPending} onCancel={() => setEditing(false)} onSave={body => save.mutate(body)} />}

      {!editing && c && (
        <>
          {c.headline && <p className="text-lg font-medium">{c.headline}</p>}

          <div className="grid gap-3 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardContent className="p-3 space-y-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">The UK story</h2>
                {c.ukStory ? <p className="text-sm whitespace-pre-wrap">{c.ukStory}</p> : <p className="text-sm text-muted-foreground italic">Not written yet.</p>}
                {photos.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1" data-testid="landsec-brand-case-photos">
                    {photos.map(p => (
                      <figure key={p.id} className="relative group">
                        <a href={p.url} target="_blank" rel="noreferrer"><img src={p.url} alt={p.caption || ""} className="w-full h-36 object-cover rounded-md border" loading="lazy" /></a>
                        {p.caption && <figcaption className="text-[11px] text-muted-foreground mt-0.5 truncate">{p.caption}</figcaption>}
                        {data.canEdit && <button type="button" className="absolute top-1 right-1 rounded bg-background/80 p-1 opacity-0 group-hover:opacity-100" title="Remove" onClick={() => removeEvidence.mutate(p.id)}><Trash2 className="w-3 h-3" /></button>}
                      </figure>
                    ))}
                  </div>
                )}
                {(videos.length > 0 || links.length > 0) && (
                  <ul className="space-y-1 pt-1">
                    {videos.map(v => <li key={v.id} className="text-sm flex items-center gap-2"><Play className="w-3.5 h-3.5 text-muted-foreground" /><a href={v.url} target="_blank" rel="noreferrer" className="hover:underline truncate">{v.caption || v.url}</a>{data.canEdit && <button type="button" onClick={() => removeEvidence.mutate(v.id)} title="Remove"><Trash2 className="w-3 h-3 text-muted-foreground" /></button>}</li>)}
                    {links.map(l => <li key={l.id} className="text-sm flex items-center gap-2">{l.kind === "file" ? <FileText className="w-3.5 h-3.5 text-muted-foreground" /> : <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />}<a href={l.url} target="_blank" rel="noreferrer" className="hover:underline truncate">{l.caption || l.url}</a>{data.canEdit && <button type="button" onClick={() => removeEvidence.mutate(l.id)} title="Remove"><Trash2 className="w-3 h-3 text-muted-foreground" /></button>}</li>)}
                  </ul>
                )}
                {data.canEdit && (
                  <div className="pt-1">
                    <input ref={fileRef} type="file" accept="image/*,video/mp4,video/quicktime,.pdf" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void uploadFile(f); }} />
                    <Button variant="outline" size="sm" className="h-7 text-xs" disabled={uploading} onClick={() => fileRef.current?.click()} data-testid="landsec-brand-case-upload"><Upload className="w-3 h-3 mr-1" /> {uploading ? "Uploading…" : "Add store photo, video or PDF"}</Button>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-3 space-y-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Covenant</h2>
                <div className="flex items-center gap-2 text-sm">
                  {c.brand.ukEntityName && <span>{c.brand.ukEntityName}</span>}
                  {c.brand.companiesHouseNumber && <span className="text-muted-foreground">{c.brand.companiesHouseNumber}</span>}
                  <CovenantBadgeByCompany companyId={companyId} />
                </div>
                {c.brand.backers && <p className="text-sm"><span className="text-muted-foreground">Backers: </span>{c.brand.backers}</p>}
                {c.covenantSummary ? <p className="text-sm whitespace-pre-wrap">{c.covenantSummary}</p> : <p className="text-sm text-muted-foreground italic">No covenant summary yet.</p>}
                {c.brand.kycStatus && <p className="text-[11px] text-muted-foreground">KYC {c.brand.kycStatus}{c.brand.amlRiskLevel ? ` · AML risk ${c.brand.amlRiskLevel}` : ""} (BGP only)</p>}
                {c.brand.website && <a href={/^https?:/.test(c.brand.website) ? c.brand.website : `https://${c.brand.website}`} target="_blank" rel="noreferrer" className="text-xs hover:underline flex items-center gap-1"><ExternalLink className="w-3 h-3" /> Website</a>}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="p-3 space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Proposed Landsec units</h2>
              {c.proposedUnits.length === 0 ? <p className="text-sm text-muted-foreground italic">No units proposed yet.</p> : (
                <table className="w-full text-sm">
                  <thead className="text-[11px] uppercase tracking-wide text-muted-foreground"><tr><th className="text-left font-medium py-1">Scheme</th><th className="text-left font-medium py-1">Unit</th><th className="text-left font-medium py-1">Now</th><th className="text-left font-medium py-1">Status</th><th className="text-left font-medium py-1">Note</th></tr></thead>
                  <tbody>
                    {c.proposedUnits.map(u => (
                      <tr key={u.id} className="border-t">
                        <td className="py-1"><Link href={`/landsec/scheme/${u.schemeKey}`} className="hover:underline">{u.schemeName}</Link></td>
                        <td className="py-1">{u.tenancyUnitId ? <Link href={`/landsec/unit/${u.tenancyUnitId}`} className="hover:underline">{u.unitLabel || "Unit"}</Link> : u.unitLabel || "—"}</td>
                        <td className="py-1 text-muted-foreground">{u.unitTenant || u.unitStatus || "—"}</td>
                        <td className="py-1">{u.status || "—"}</td>
                        <td className="py-1 text-muted-foreground">{u.note || ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <Card data-testid="landsec-brand-case-responses">
            <CardContent className="p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Where the asset managers stand</h2>
                <div className="flex gap-1">
                  {LANDSEC_CASE_RESPONSES.map(r => <span key={r.key} className="rounded-full border px-2 py-px text-[10px] uppercase tracking-wide tabular-nums">{r.label} {c.tally[r.key] || 0}</span>)}
                </div>
              </div>
              <div className="rounded-md border p-2.5 space-y-1.5">
                <p className="text-xs text-muted-foreground">Your response{data.myResponse ? ` — recorded ${fmtDate(data.myResponse.at)}` : ""}</p>
                <div className="flex flex-wrap gap-1.5">
                  {LANDSEC_CASE_RESPONSES.map(r => (
                    <Button key={r.key} size="sm" variant={data.myResponse?.response === r.key ? "default" : "outline"} className="h-7 text-xs" disabled={respond.isPending}
                      onClick={() => respond.mutate({ response: r.key, note: note || undefined, role: role || undefined })} data-testid={`landsec-brand-case-respond-${r.key}`}>
                      {r.label}
                    </Button>
                  ))}
                </div>
                <div className="grid sm:grid-cols-[1fr_2fr] gap-1.5">
                  <Input value={role} onChange={e => setRole(e.target.value)} placeholder="Your role and scheme, e.g. Asset manager, Bluewater" className="h-8 text-sm" />
                  <Input value={note} onChange={e => setNote(e.target.value)} placeholder="A line on why (optional) — then press a response" className="h-8 text-sm" />
                </div>
              </div>
              {c.responses.length === 0 ? <p className="text-sm text-muted-foreground italic">No responses yet.</p> : (
                <ul className="divide-y">
                  {c.responses.map(r => (
                    <li key={r.id} className="py-1.5 text-sm flex flex-wrap items-baseline gap-x-2">
                      <span className="font-medium">{r.userName || "Someone"}</span>
                      {r.userRole && <span className="text-xs text-muted-foreground">{r.userRole}</span>}
                      <span className="rounded-full bg-foreground text-background px-2 py-px text-[10px] font-semibold uppercase tracking-wide">{LANDSEC_CASE_RESPONSES.find(x => x.key === r.response)?.label || r.response}</span>
                      {r.note && <span className="text-muted-foreground">{r.note}</span>}
                      <span className="text-[11px] text-muted-foreground ml-auto">{fmtDate(r.at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          {c.updatedAt && <p className="text-[11px] text-muted-foreground">Case last changed {fmtDate(c.updatedAt)}{c.updatedByName ? ` by ${c.updatedByName}` : ""}.</p>}
        </>
      )}

      {!editing && !c && !data.canEdit && <p className="text-sm text-muted-foreground">BGP has not written this brand's case yet.</p>}
    </div>
  );
}

function CaseEditor({ initial, schemes, saving, onCancel, onSave }: {
  initial: CaseData["case"]; schemes: { key: string; name: string }[]; saving: boolean;
  onCancel: () => void; onSave: (body: Record<string, any>) => void;
}) {
  const [headline, setHeadline] = useState(initial?.headline || "");
  const [ukStory, setUkStory] = useState(initial?.ukStory || "");
  const [covenantSummary, setCovenantSummary] = useState(initial?.covenantSummary || "");
  const [links, setLinks] = useState<{ id?: string; kind: "link" | "video"; url: string; caption: string }[]>(
    (initial?.evidence || []).filter(e => e.kind === "link" || e.kind === "video").map(e => ({ id: e.id, kind: e.kind as "link" | "video", url: e.url, caption: e.caption || "" })));
  const [units, setUnits] = useState<{ id?: string; schemeKey: string; tenancyUnitId: string | null; unitLabel: string; note: string; status: string }[]>(
    (initial?.proposedUnits || []).map(u => ({ id: u.id, schemeKey: u.schemeKey, tenancyUnitId: u.tenancyUnitId, unitLabel: u.unitLabel, note: u.note || "", status: u.status || "" })));
  return (
    <Card>
      <CardContent className="p-3 space-y-2 text-sm" data-testid="landsec-brand-case-editor">
        <label className="text-xs text-muted-foreground block">Headline<Input value={headline} onChange={e => setHeadline(e.target.value)} placeholder="One line: why this brand belongs across the portfolio" className="h-8 text-sm" /></label>
        <label className="text-xs text-muted-foreground block">The UK story<Textarea value={ukStory} onChange={e => setUkStory(e.target.value)} rows={5} className="text-sm" placeholder="Product quality, fit-out, queues, trading evidence, the UK operator and backers — what the asset managers have not seen yet" /></label>
        <label className="text-xs text-muted-foreground block">Covenant summary<Textarea value={covenantSummary} onChange={e => setCovenantSummary(e.target.value)} rows={3} className="text-sm" placeholder="UK entity, who stands behind it, guarantees offered, accounts filed" /></label>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Links and videos (store photos and PDFs are uploaded from the case once saved)</p>
          {links.map((l, i) => (
            <div key={i} className="grid grid-cols-[6rem_1fr_1fr_auto] gap-1.5">
              <select className="h-8 rounded-md border bg-background px-2 text-sm" value={l.kind} onChange={e => setLinks(p => p.map((x, j) => j === i ? { ...x, kind: e.target.value as "link" | "video" } : x))}><option value="link">Link</option><option value="video">Video</option></select>
              <Input value={l.url} onChange={e => setLinks(p => p.map((x, j) => j === i ? { ...x, url: e.target.value } : x))} placeholder="https://…" className="h-8 text-sm" />
              <Input value={l.caption} onChange={e => setLinks(p => p.map((x, j) => j === i ? { ...x, caption: e.target.value } : x))} placeholder="Caption" className="h-8 text-sm" />
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setLinks(p => p.filter((_, j) => j !== i))}><Trash2 className="w-3.5 h-3.5" /></Button>
            </div>
          ))}
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setLinks(p => [...p, { kind: "link", url: "", caption: "" }])}>Add link</Button>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Proposed Landsec units</p>
          {units.map((u, i) => (
            <UnitPicker key={i} value={u} schemes={schemes} onChange={v => setUnits(p => p.map((x, j) => j === i ? v : x))} onRemove={() => setUnits(p => p.filter((_, j) => j !== i))} />
          ))}
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setUnits(p => [...p, { schemeKey: schemes[0]?.key || "", tenancyUnitId: null, unitLabel: "", note: "", status: "Proposed" }])} data-testid="landsec-brand-case-add-unit">Add unit</Button>
        </div>
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="outline" onClick={onCancel}>Cancel</Button>
          <Button size="sm" disabled={saving} onClick={() => onSave({ headline, ukStory, covenantSummary, links, proposedUnits: units })} data-testid="landsec-brand-case-save">Save case</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function UnitPicker({ value, schemes, onChange, onRemove }: {
  value: { id?: string; schemeKey: string; tenancyUnitId: string | null; unitLabel: string; note: string; status: string };
  schemes: { key: string; name: string }[]; onChange: (v: typeof value) => void; onRemove: () => void;
}) {
  const { data } = useQuery<{ units: { id: string; unit: string | null; status: string | null; tenant: string | null }[] }>({ queryKey: [`/api/landsec/scheme/${value.schemeKey}`], enabled: !!value.schemeKey, staleTime: 60 * 1000 });
  return (
    <div className="grid sm:grid-cols-[10rem_1fr_7rem_1fr_auto] gap-1.5">
      <select className="h-8 rounded-md border bg-background px-2 text-sm" value={value.schemeKey} onChange={e => onChange({ ...value, schemeKey: e.target.value, tenancyUnitId: null, unitLabel: "" })}>
        {schemes.map(s => <option key={s.key} value={s.key}>{s.name}</option>)}
      </select>
      <select className="h-8 rounded-md border bg-background px-2 text-sm" value={value.tenancyUnitId || ""} onChange={e => { const u = data?.units.find(x => x.id === e.target.value); onChange({ ...value, tenancyUnitId: e.target.value || null, unitLabel: u?.unit || value.unitLabel }); }}>
        <option value="">— pick a unit (or type below) —</option>
        {data?.units.map(u => <option key={u.id} value={u.id}>{u.unit}{u.tenant ? ` · ${u.tenant}` : u.status ? ` · ${u.status}` : ""}</option>)}
      </select>
      <select className="h-8 rounded-md border bg-background px-2 text-sm" value={value.status} onChange={e => onChange({ ...value, status: e.target.value })}>
        {["Proposed", "Agreed", "Under offer", "Declined"].map(s => <option key={s} value={s}>{s}</option>)}
      </select>
      <Input value={value.tenancyUnitId ? value.note : value.unitLabel ? value.note : value.unitLabel} onChange={e => onChange(value.tenancyUnitId || value.unitLabel ? { ...value, note: e.target.value } : { ...value, unitLabel: e.target.value })} placeholder={value.tenancyUnitId || value.unitLabel ? "Note" : "Unit name"} className="h-8 text-sm" />
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onRemove}><Trash2 className="w-3.5 h-3.5" /></Button>
    </div>
  );
}
