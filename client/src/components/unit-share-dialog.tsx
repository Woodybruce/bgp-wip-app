// Share a Letting Tracker unit with a brand (Woody, 2026-11-12): pick the
// brand and the contact from the CRM (or add them), tick what goes, then
// either one PDF or an Outlook draft with attachments. For BGP staff, and for
// a joint agent on their scheme, who types the recipient or picks a brand
// already named on the unit, gets one PDF, and never calls the CRM.
// Routes: server/unit-share.ts. The brand never sees fees, the rent floor,
// other offers or the Targeting Brief: the server offers only what may go.
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Download, ExternalLink, FileText, Image as ImageIcon, Loader2, Mail, UserPlus } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Pill } from "@/components/ui/pill";
import { EntityCombobox } from "@/components/entity-combobox";
import { apiRequest, getAuthHeaders, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// What GET /api/unit-share/:unitId/options answers (server/unit-share.ts).
interface ShareFact { key: string; label: string; value: string }
interface ShareFile { id: string; fileName: string; mimeType: string; sizeBytes: number | null; url: string; canMerge: boolean }
interface SharePlan { id: string; label: string; canMerge: boolean; picked: boolean; url: string; sizeBytes: number | null }
interface ShareBrochure { id: string; name: string; canMerge: boolean; picked: boolean; url: string; sizeBytes: number | null }
interface ShareHistoryItem {
  id: string; companyId: string | null; companyName: string | null; contactName: string | null; contactEmail: string | null;
  mode: "pdf" | "email"; summary: string; how: string; createdAt: string | null; createdByName: string | null;
  packUrl: string | null; packFileName: string | null; draftUrl: string | null;
}
interface ShareOptions {
  unit: { id: string; unitName: string; propertyName: string | null; floor: string | null; sqft: number | null; useClass: string | null; availableDate: string | null };
  details: ShareFact[];
  commercials: ShareFact[];
  files: { floorplans: ShareFile[]; brochures: ShareFile[]; photos: ShareFile[]; other: ShareFile[] };
  schemePlans: SharePlan[];
  schemeBrochures: ShareBrochure[];
  history: ShareHistoryItem[];
  sender: { name: string | null; email: string | null };
  emailLimitBytes: number;
  // How this login names the recipient and sends (server/unit-share.ts).
  viewer?: { crmPicker: boolean; outlookDraft: boolean };
  brands?: UnitBrand[];              // brands already named on the unit, for a joint agent's pick-list
}
interface UnitBrand { id: string | null; name: string }
interface SkippedFile { name: string; reason: string }
type ShareResult =
  | { kind: "pdf"; url: string; fileName: string; pages: number; skipped: SkippedFile[] }
  | { kind: "draft"; webLink: string | null; attachments: { name: string; sizeBytes: number }[]; skipped: SkippedFile[] }
  | { kind: "failed"; message: string; url: string; fileName: string; mailto: string; skipped: SkippedFile[] };

interface CompanyRow { id: string; name: string }
interface ContactRow { id: string; name: string; email: string | null; role: string | null; companyId: string | null }
type Mode = "pdf" | "email";

export interface UnitShareDialogProps {
  unit: { id: string; unitName: string; propertyId: string | null } | null;
  open: boolean;
  onClose: () => void;
}

const MICRO_LABEL = "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";
const EMAIL_SHAPE = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const HISTORY_SHOWN = 5;
const BRANDS_SHOWN = 12;
// The commercials that are figures (shown in the money face); the rest are words.
const FIGURE_KEYS = new Set(["quotingRentPa", "serviceChargePa", "ratesPayablePa", "insurancePa", "leaseTermYears"]);

const fmtDate = (d: string | null | undefined): string =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
const fmtSize = (n: number | null | undefined): string => {
  if (!n || n <= 0) return "";
  return n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
};
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
// apiRequest throws "409: the server's message".
const serverMessage = (e: unknown, fallback: string): string =>
  (e instanceof Error ? e.message.replace(/^\d{3}:\s*/, "") : "") || fallback;

async function saveBlob(url: string, fileName: string): Promise<void> {
  const res = await fetch(url, { credentials: "include", headers: getAuthHeaders() });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message || `The server answered ${res.status}`);
  }
  const href = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = href;
  a.download = fileName || "Unit details.pdf";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1500);
}

// An image from a signed-in route. The plain request carries the session
// cookie; where only the bearer token is held it is fetched with the token.
function Thumb({ url, alt, className }: { url: string; alt: string; className?: string }) {
  const [src, setSrc] = useState(url);
  const [failed, setFailed] = useState(false);
  const retried = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
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

export function UnitShareDialog({ unit, open, onClose }: UnitShareDialogProps) {
  return (
    <Dialog open={open && !!unit} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent
        className="max-w-2xl max-h-[90vh] overflow-y-auto overflow-x-hidden content-start max-sm:h-[100dvh] max-sm:max-h-[100dvh] max-sm:w-screen max-sm:rounded-none max-sm:p-4"
        data-testid="unit-share-dialog"
      >
        <DialogHeader className="text-left">
          <DialogTitle className="pr-6 break-words">Share {unit?.unitName || "this unit"} with a brand</DialogTitle>
          <DialogDescription>Pick who it is for and what to include. Nothing is sent from here.</DialogDescription>
        </DialogHeader>
        {unit && open && <ShareBody key={unit.id} unit={unit} />}
      </DialogContent>
    </Dialog>
  );
}

function ShareBody({ unit }: { unit: NonNullable<UnitShareDialogProps["unit"]> }) {
  const { toast } = useToast();
  const optionsKey = useMemo(() => ["/api/unit-share", unit.id, "options"], [unit.id]);
  const { data: options, isLoading, error } = useQuery<ShareOptions>({ queryKey: optionsKey });
  // BGP staff pick the brand and the contact from the CRM. A joint agent has
  // no CRM: nothing under /api/crm is asked for until the server says this
  // login picks from it.
  const crmPicker = !!options && options.viewer?.crmPicker !== false;
  const canDraft = !!options && options.viewer?.outlookDraft !== false;
  const { data: companies = [], isLoading: companiesLoading } = useQuery<CompanyRow[]>({ queryKey: ["/api/crm/companies"], enabled: crmPicker });

  // Who it is for
  const [typedBrand, setTypedBrand] = useState("");
  const [typedBrandId, setTypedBrandId] = useState<string | null>(null);
  const [typedContactName, setTypedContactName] = useState("");
  const [showAllBrands, setShowAllBrands] = useState(false);
  const [companyId, setCompanyId] = useState("");
  const [createdCompanies, setCreatedCompanies] = useState<CompanyRow[]>([]);
  const [contactId, setContactId] = useState("");
  const [typedEmail, setTypedEmail] = useState("");
  const [addingContact, setAddingContact] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [savingContact, setSavingContact] = useState(false);
  const contactsKey = useMemo(() => [`/api/crm/contacts?companyId=${encodeURIComponent(companyId)}`], [companyId]);
  const { data: contactRows = [], isLoading: contactsLoading } = useQuery<ContactRow[]>({ queryKey: contactsKey, enabled: crmPicker && !!companyId });

  // What to include
  const [details, setDetails] = useState(true);
  const [commercialKeys, setCommercialKeys] = useState<Set<string>>(new Set());
  const [fileIds, setFileIds] = useState<Set<string>>(new Set());
  const [planIds, setPlanIds] = useState<Set<string>>(new Set());
  const [brochureIds, setBrochureIds] = useState<Set<string>>(new Set());
  const seeded = useRef(false);

  // How to send it
  const [mode, setMode] = useState<Mode>("pdf");
  const [asSinglePdf, setAsSinglePdf] = useState(true);
  const [subject, setSubject] = useState("");
  const [subjectEdited, setSubjectEdited] = useState(false);
  const [message, setMessage] = useState("");
  const [messageEdited, setMessageEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ShareResult | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [showAllHistory, setShowAllHistory] = useState(false);

  // The first answer sets the ticks: the quoting terms, the unit's plans,
  // brochures and photos, and the scheme plans and brochures on its brief.
  // Other files start unticked.
  useEffect(() => {
    if (!options || seeded.current) return;
    seeded.current = true;
    setDetails(options.details.length > 0);
    setCommercialKeys(new Set(options.commercials.map(c => c.key)));
    setFileIds(new Set([...options.files.floorplans, ...options.files.brochures, ...options.files.photos].map(f => f.id)));
    setPlanIds(new Set(options.schemePlans.filter(p => p.picked).map(p => p.id)));
    setBrochureIds(new Set(options.schemeBrochures.filter(b => b.picked).map(b => b.id)));
  }, [options]);

  const companyItems = useMemo(() => {
    const known = new Set(companies.map(c => c.id));
    return [...companies, ...createdCompanies.filter(c => !known.has(c.id))].map(c => ({ id: c.id, label: c.name }));
  }, [companies, createdCompanies]);
  const companyName = companyItems.find(c => c.id === companyId)?.label || "";
  const contacts = useMemo(() => contactRows.filter(c => c.companyId === companyId && (c.name || "").trim()), [contactRows, companyId]);
  const contact = contacts.find(c => c.id === contactId) || null;
  const contactEmail = contact?.email && EMAIL_SHAPE.test(contact.email.trim()) ? contact.email.trim() : "";
  const recipientEmail = contactEmail || typedEmail.trim();
  const emailOk = !!recipientEmail && EMAIL_SHAPE.test(recipientEmail);

  const picked = useMemo(() => {
    const of = <T extends { id: string }>(list: T[], ids: Set<string>) => list.filter(x => ids.has(x.id));
    const o = options;
    return {
      commercials: o ? o.commercials.filter(c => commercialKeys.has(c.key)) : [],
      floorplans: o ? of(o.files.floorplans, fileIds) : [],
      brochures: o ? of(o.files.brochures, fileIds) : [],
      photos: o ? of(o.files.photos, fileIds) : [],
      other: o ? of(o.files.other, fileIds) : [],
      schemePlans: o ? of(o.schemePlans, planIds) : [],
      schemeBrochures: o ? of(o.schemeBrochures, brochureIds) : [],
    };
  }, [options, commercialKeys, fileIds, planIds, brochureIds]);
  const fileCount = picked.floorplans.length + picked.brochures.length + picked.photos.length + picked.other.length + picked.schemePlans.length + picked.schemeBrochures.length;
  const anything = details || picked.commercials.length > 0 || fileCount > 0;

  // The same words the server writes when no message is sent.
  const suggestedSubject = options ? `${options.unit.unitName}${options.unit.propertyName ? `, ${options.unit.propertyName}` : ""}: details`.slice(0, 250) : "";
  const suggestedMessage = useMemo(() => {
    if (!options) return "";
    const first = (contact?.name || "").trim().split(/\s+/)[0];
    const where = `${options.unit.unitName}${options.unit.propertyName ? ` at ${options.unit.propertyName}` : ""}`;
    const brochures = picked.brochures.length + picked.schemeBrochures.length;
    const lines = [
      details ? "Unit details" : null,
      picked.commercials.length ? "Quoting terms" : null,
      picked.floorplans.length ? plural(picked.floorplans.length, "floor plan") : null,
      picked.schemePlans.length ? plural(picked.schemePlans.length, "scheme plan") : null,
      brochures ? plural(brochures, "brochure") : null,
      picked.photos.length ? plural(picked.photos.length, "photo") : null,
      picked.other.length ? plural(picked.other.length, "other file") : null,
    ].filter((x): x is string => !!x);
    return [
      first ? `Dear ${first},` : "Hello,",
      asSinglePdf ? `Please find attached the details of ${where}, in one PDF. It includes:` : `Please find attached the details of ${where}:`,
      lines.map(l => `- ${l}`).join("\n"),
      "Please let me know if you would like to arrange a viewing.",
      `${options.sender.name || ""}\nBruce Gillingham Pollard`.trim(),
    ].join("\n\n");
  }, [options, contact, picked, details, asSinglePdf]);
  useEffect(() => { if (!subjectEdited) setSubject(suggestedSubject); }, [suggestedSubject, subjectEdited]);
  useEffect(() => { if (!messageEdited) setMessage(suggestedMessage); }, [suggestedMessage, messageEdited]);

  const toggle = (set: Set<string>, write: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    write(next);
    setResult(null);
  };
  const setMany = (set: Set<string>, write: (s: Set<string>) => void, ids: string[], on: boolean) => {
    const next = new Set(set);
    for (const id of ids) { if (on) next.add(id); else next.delete(id); }
    write(next);
    setResult(null);
  };

  const pickCompany = (id: string) => {
    setCompanyId(id);
    setContactId("");
    setTypedEmail("");
    setAddingContact(false);
    setResult(null);
  };

  const createCompany = async (name: string) => {
    try {
      const r = await apiRequest("POST", "/api/crm/companies", { name: name.trim(), companyType: "Tenant" });
      const created = await r.json();
      const row = { id: String(created.id), name: String(created.name) };
      setCreatedCompanies(list => [...list, row]);
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
      toast({ title: created.unhidden ? "Brand brought back" : "Brand added", description: `${row.name} is in the CRM.` });
      return { id: row.id, label: row.name };
    } catch (e) {
      toast({ title: "The brand was not added", description: serverMessage(e, "Try again."), variant: "destructive" });
      throw e;
    }
  };

  const addContact = async (e: FormEvent) => {
    e.preventDefault();
    const name = newName.trim(), email = newEmail.trim();
    if (!companyId || !name || savingContact) return;
    if (email && !EMAIL_SHAPE.test(email)) { toast({ title: "That email address does not look right", variant: "destructive" }); return; }
    setSavingContact(true);
    try {
      const r = await apiRequest("POST", "/api/crm/contacts", { name, email: email || null, companyId, companyName });
      const created = await r.json();
      queryClient.setQueryData<ContactRow[]>(contactsKey, old => [...(old || []), { id: String(created.id), name: created.name, email: created.email || null, role: created.role || null, companyId }]);
      queryClient.invalidateQueries({ queryKey: ["/api/crm/contacts"] });
      setContactId(String(created.id));
      setTypedEmail("");
      setAddingContact(false);
      setNewName("");
      setNewEmail("");
      setResult(null);
      toast({ title: "Contact added", description: `${created.name} is in the CRM under ${companyName}.` });
    } catch (err) {
      toast({ title: "The contact was not added", description: serverMessage(err, "Try again."), variant: "destructive" });
    } finally {
      setSavingContact(false);
    }
  };

  const download = async (key: string, url: string, fileName: string) => {
    if (downloading) return;
    setDownloading(key);
    try {
      await saveBlob(url, fileName);
    } catch (e) {
      toast({ title: "The PDF could not be downloaded", description: (e as Error).message, variant: "destructive" });
    } finally {
      setDownloading(null);
    }
  };

  const blocker = crmPicker && !companyId ? "Pick the brand first."
    : !crmPicker && !typedBrand.trim() ? "Type the brand first, or pick one named on this unit."
    : !crmPicker && typedEmail.trim() && !EMAIL_SHAPE.test(typedEmail.trim()) ? "That email address does not look right."
    : !anything ? "Tick at least one thing to share."
    : mode === "email" && !emailOk ? (recipientEmail ? "That email address does not look right." : "Add an email address for the draft.")
    : "";

  // A typed recipient: the brand by name (or the id of one named on the
  // unit), the person and their address as typed. No CRM ids.
  const typedRecipient = () => ({
    ...(typedBrandId ? { companyId: typedBrandId } : { companyName: typedBrand.trim() }),
    ...(typedContactName.trim() ? { contactName: typedContactName.trim() } : {}),
    ...(typedEmail.trim() ? { contactEmail: typedEmail.trim() } : {}),
  });

  const send = async () => {
    if (busy || blocker || !options) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(`/api/unit-share/${unit.id}/send`, {
        method: "POST",
        credentials: "include",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: crmPicker
            ? { companyId, ...(contactId ? { contactId } : {}), ...(!contactEmail && typedEmail.trim() ? { contactEmail: typedEmail.trim() } : {}) }
            : typedRecipient(),
          include: {
            details,
            commercialKeys: picked.commercials.map(c => c.key),
            fileIds: [...picked.floorplans, ...picked.brochures, ...picked.photos, ...picked.other].map(f => f.id),
            schemePlanIds: picked.schemePlans.map(p => p.id),
            schemeBrochureIds: picked.schemeBrochures.map(b => b.id),
          },
          mode,
          ...(mode === "email" ? { asSinglePdf, subject: subject.trim() || suggestedSubject, message: message.trim() || suggestedMessage } : {}),
        }),
      });
      const body = await res.json().catch(() => null);
      const skipped: SkippedFile[] = Array.isArray(body?.skipped) ? body.skipped : [];
      if (res.ok && mode === "pdf") {
        setResult({ kind: "pdf", url: body.url, fileName: body.fileName, pages: body.pages, skipped });
        await saveBlob(body.url, body.fileName).catch(() =>
          toast({ title: "The PDF is made but did not download", description: "Use Download again below.", variant: "destructive" }));
      } else if (res.ok) {
        setResult({ kind: "draft", webLink: body.draftWebLink || null, attachments: Array.isArray(body.attachments) ? body.attachments : [], skipped });
      } else if (body?.code === "DRAFT_FAILED" && body.fallback) {
        setResult({ kind: "failed", message: body.message, url: body.fallback.url, fileName: body.fallback.fileName, mailto: body.fallback.mailto, skipped });
      } else {
        toast({ title: mode === "pdf" ? "The PDF was not made" : "The draft was not made", description: body?.message || `The server answered ${res.status}. Try again.`, variant: "destructive" });
      }
      queryClient.invalidateQueries({ queryKey: optionsKey });
    } catch {
      toast({ title: "Nothing was shared", description: "The app could not be reached. Check the connection and try again.", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-3" data-testid="unit-share-loading">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (error || !options) {
    return <p className="text-sm text-muted-foreground" data-testid="unit-share-error">{serverMessage(error, "What can be shared could not be loaded. Close this and try again.")}</p>;
  }

  const separateNote = mode === "pdf" ? "left out of the single PDF" : asSinglePdf ? "attached separately" : "";
  const hasFiles = options.files.floorplans.length + options.files.brochures.length + options.files.photos.length + options.files.other.length + options.schemePlans.length + options.schemeBrochures.length > 0;
  const separateBytes = [...picked.floorplans, ...picked.brochures, ...picked.photos, ...picked.other, ...picked.schemePlans, ...picked.schemeBrochures].reduce((n, f) => n + (f.sizeBytes || 0), 0);
  const history = showAllHistory ? options.history : options.history.slice(0, HISTORY_SHOWN);
  const unitBrands = options.brands || [];
  const shownBrands = showAllBrands ? unitBrands : unitBrands.slice(0, BRANDS_SHOWN);

  return (
    <div className="space-y-6 min-w-0" data-testid="unit-share-body">
      {/* 1. Who is it for */}
      <section className="space-y-3 min-w-0" data-testid="unit-share-who">
        <h3 className="text-sm font-semibold">Who is it for</h3>
        {!crmPicker && (
          <div className="space-y-3 min-w-0" data-testid="unit-share-typed-recipient">
            <div className="space-y-1">
              <Label htmlFor="unit-share-brand-name" className={MICRO_LABEL}>Brand</Label>
              <Input id="unit-share-brand-name" value={typedBrand} maxLength={200} autoComplete="off" placeholder="The brand's name"
                onChange={e => { setTypedBrand(e.target.value); setTypedBrandId(null); setResult(null); }} data-testid="unit-share-brand-name" />
            </div>
            {unitBrands.length > 0 && (
              <div className="space-y-1.5" data-testid="unit-share-unit-brands">
                <p className={MICRO_LABEL}>Already named on this unit</p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {shownBrands.map(b => {
                    const on = typedBrand.trim().toLowerCase() === b.name.toLowerCase();
                    return (
                      <Pill key={`${b.id || ""}:${b.name}`} active={on} aria-pressed={on} className="max-w-full"
                        onClick={() => { setTypedBrand(b.name); setTypedBrandId(b.id); setResult(null); }} data-testid={`unit-share-unit-brand-${b.id || b.name}`}>
                        <span className="min-w-0 truncate">{b.name}</span>
                      </Pill>
                    );
                  })}
                  {unitBrands.length > BRANDS_SHOWN && !showAllBrands && (
                    <Pill onClick={() => setShowAllBrands(true)} data-testid="unit-share-unit-brands-all">Show all {unitBrands.length}</Pill>
                  )}
                </div>
              </div>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1 min-w-0">
                <Label htmlFor="unit-share-typed-name" className={MICRO_LABEL}>Person (optional)</Label>
                <Input id="unit-share-typed-name" value={typedContactName} maxLength={200} autoComplete="off"
                  onChange={e => { setTypedContactName(e.target.value); setResult(null); }} data-testid="unit-share-typed-name" />
              </div>
              <div className="space-y-1 min-w-0">
                <Label htmlFor="unit-share-typed-email" className={MICRO_LABEL}>Email (optional)</Label>
                <Input id="unit-share-typed-email" type="email" inputMode="email" value={typedEmail} maxLength={200} placeholder="name@brand.com" autoComplete="off"
                  onChange={e => { setTypedEmail(e.target.value); setResult(null); }} data-testid="unit-share-typed-email" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Who it went to is kept in this unit's sharing history, which BGP can also read.</p>
          </div>
        )}
        {crmPicker && (
        <div className="space-y-1">
          <p className={MICRO_LABEL}>Brand</p>
          <EntityCombobox
            items={companyItems}
            value={companyId}
            onChange={pickCompany}
            placeholder="Pick a brand from the CRM"
            ariaLabel="Brand"
            searchPlaceholder="Search brands, or type a new name"
            loading={companiesLoading}
            testId="unit-share-company"
            onCreate={createCompany}
            createLabel="brand"
          />
          {!companyId && <p className="text-xs text-muted-foreground">Not in the CRM yet? Type the name and choose Create brand.</p>}
        </div>
        )}

        {crmPicker && companyId && (
          <div className="space-y-2 min-w-0" data-testid="unit-share-contact-block">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className={MICRO_LABEL}>Contact{mode === "pdf" ? " (optional for a PDF)" : ""}</p>
              {!addingContact && (
                <Button type="button" variant="outline" size="sm" onClick={() => setAddingContact(true)} data-testid="unit-share-add-contact">
                  <UserPlus className="h-3.5 w-3.5 mr-1" /> Add a new contact
                </Button>
              )}
            </div>
            {contactsLoading ? <Skeleton className="h-9 w-full" /> : contacts.length > 0 ? (
              <EntityCombobox
                items={contacts.map(c => ({ id: c.id, label: c.name, subLabel: [c.role, c.email].filter(Boolean).join(" · ") || "No email on record" }))}
                value={contactId}
                onChange={id => { setContactId(id); setTypedEmail(""); setResult(null); }}
                placeholder={`Pick a contact at ${companyName}`}
                ariaLabel="Contact"
                searchPlaceholder="Search contacts"
                testId="unit-share-contact"
              />
            ) : !addingContact && (
              <p className="text-sm text-muted-foreground" data-testid="unit-share-no-contacts">No contacts at {companyName} yet. Add one, or type an email address below.</p>
            )}

            {addingContact && (
              <form onSubmit={addContact} className="rounded-lg border border-dashed p-3 space-y-2" data-testid="unit-share-new-contact-form">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1 min-w-0">
                    <Label htmlFor="unit-share-new-name" className={MICRO_LABEL}>Name</Label>
                    <Input id="unit-share-new-name" value={newName} onChange={e => setNewName(e.target.value)} maxLength={200} autoComplete="off" data-testid="unit-share-new-contact-name" />
                  </div>
                  <div className="space-y-1 min-w-0">
                    <Label htmlFor="unit-share-new-email" className={MICRO_LABEL}>Email</Label>
                    <Input id="unit-share-new-email" type="email" inputMode="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} maxLength={200} autoComplete="off" data-testid="unit-share-new-contact-email" />
                  </div>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setAddingContact(false)} data-testid="unit-share-new-contact-cancel">Cancel</Button>
                  <Button type="submit" variant="outline" size="sm" disabled={!newName.trim() || savingContact} data-testid="unit-share-new-contact-save">
                    {savingContact && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />} Add contact
                  </Button>
                </div>
              </form>
            )}

            {contact && contactEmail && (
              <p className="text-sm break-all" data-testid="unit-share-contact-email">
                <Mail className="inline h-3.5 w-3.5 mr-1 text-muted-foreground" aria-hidden />{contactEmail}
              </p>
            )}
            {!contactEmail && !addingContact && (contact || mode === "email") && (
              <div className="space-y-1">
                <Label htmlFor="unit-share-typed-email" className={MICRO_LABEL}>{contact ? `Email for ${contact.name}` : "Email address"}</Label>
                <Input id="unit-share-typed-email" type="email" inputMode="email" value={typedEmail} onChange={e => { setTypedEmail(e.target.value); setResult(null); }} maxLength={200} placeholder="name@brand.com" autoComplete="off" data-testid="unit-share-typed-email" />
                <p className="text-xs text-muted-foreground">
                  {contact ? `${contact.name} has no email in the CRM. ` : ""}This address is used for this share only. It is not saved to the CRM.
                </p>
              </div>
            )}
          </div>
        )}
      </section>

      {/* 2. What to include */}
      <section className="space-y-3 min-w-0" data-testid="unit-share-what">
        <h3 className="text-sm font-semibold">What to include</h3>

        {options.details.length > 0 && (
          <div className="rounded-lg border p-3 space-y-1.5">
            <TickRow id="unit-share-details" checked={details} onChange={v => { setDetails(v); setResult(null); }} testId="unit-share-tick-details" label="Unit details" />
            <dl className="ml-6 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs text-muted-foreground" data-testid="unit-share-details-list">
              {options.details.map(d => (
                <div key={d.key} className="contents">
                  <dt>{d.label}</dt>
                  <dd className="text-foreground break-words">{d.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {options.commercials.length > 0 ? (
          <TickGroup
            title="Commercials" testId="commercials" ticked={picked.commercials.length} total={options.commercials.length}
            onAll={() => { setCommercialKeys(new Set(options.commercials.map(c => c.key))); setResult(null); }}
            onNone={() => { setCommercialKeys(new Set()); setResult(null); }}
          >
            {options.commercials.map(c => (
              <TickRow
                key={c.key} id={`unit-share-commercial-${c.key}`} checked={commercialKeys.has(c.key)} testId={`unit-share-tick-commercial-${c.key}`}
                onChange={() => toggle(commercialKeys, setCommercialKeys, c.key)} label={c.label}
                side={c.key === "otherTerms" ? undefined : <span className={cn("break-words", FIGURE_KEYS.has(c.key) && "font-mono tabular-nums")}>{c.value}</span>}
                value={c.key === "otherTerms" ? <span className="whitespace-pre-line break-words">{c.value}</span> : undefined}
              />
            ))}
          </TickGroup>
        ) : (
          <p className="text-xs text-muted-foreground" data-testid="unit-share-no-commercials">No quoting terms on this unit yet. Add the quoting rent on the tracker or the Targeting Brief to include it.</p>
        )}

        <FileGroup title="Floor plans" testId="floorplans" items={options.files.floorplans.map(f => ({ id: f.id, name: f.fileName, size: f.sizeBytes, canMerge: f.canMerge }))}
          ids={fileIds} note={separateNote} onToggle={id => toggle(fileIds, setFileIds, id)} onMany={(ids, on) => setMany(fileIds, setFileIds, ids, on)} />
        <FileGroup title="Scheme plans" testId="scheme-plans" items={options.schemePlans.map(p => ({ id: p.id, name: p.label, size: p.sizeBytes, canMerge: p.canMerge, tag: p.picked ? "On the brief" : undefined }))}
          ids={planIds} note={separateNote} onToggle={id => toggle(planIds, setPlanIds, id)} onMany={(ids, on) => setMany(planIds, setPlanIds, ids, on)} />
        <FileGroup title="Unit brochures" testId="brochures" items={options.files.brochures.map(f => ({ id: f.id, name: f.fileName, size: f.sizeBytes, canMerge: f.canMerge }))}
          ids={fileIds} note={separateNote} onToggle={id => toggle(fileIds, setFileIds, id)} onMany={(ids, on) => setMany(fileIds, setFileIds, ids, on)} />
        <FileGroup title="Scheme brochures" testId="scheme-brochures" items={options.schemeBrochures.map(b => ({ id: b.id, name: b.name, size: b.sizeBytes, canMerge: b.canMerge, tag: b.picked ? "On the brief" : undefined }))}
          ids={brochureIds} note={separateNote} onToggle={id => toggle(brochureIds, setBrochureIds, id)} onMany={(ids, on) => setMany(brochureIds, setBrochureIds, ids, on)} />

        {options.files.photos.length > 0 && (
          <TickGroup
            title="Photos" testId="photos" ticked={picked.photos.length} total={options.files.photos.length}
            onAll={() => setMany(fileIds, setFileIds, options.files.photos.map(f => f.id), true)}
            onNone={() => setMany(fileIds, setFileIds, options.files.photos.map(f => f.id), false)}
          >
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {options.files.photos.map(f => {
                const on = fileIds.has(f.id);
                return (
                  <button
                    key={f.id} type="button" aria-pressed={on} aria-label={`${on ? "Leave out" : "Include"} photo ${f.fileName}`}
                    onClick={() => toggle(fileIds, setFileIds, f.id)} data-testid={`unit-share-photo-${f.id}`}
                    className={cn("relative aspect-[4/3] overflow-hidden rounded-md border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", on ? "border-foreground" : "border-border opacity-60")}
                  >
                    <Thumb url={`${f.url}?view=1`} alt={f.fileName} className="h-full w-full object-cover" />
                    <span className={cn("absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full border", on ? "border-transparent bg-foreground text-background" : "border-border bg-background text-transparent")}>
                      <Check className="h-3 w-3" />
                    </span>
                    {!f.canMerge && separateNote && <span className="absolute inset-x-0 bottom-0 bg-background/90 px-1 py-0.5 text-[11px] text-muted-foreground">{separateNote}</span>}
                  </button>
                );
              })}
            </div>
          </TickGroup>
        )}

        <FileGroup title="Other files" testId="other" items={options.files.other.map(f => ({ id: f.id, name: f.fileName, size: f.sizeBytes, canMerge: f.canMerge }))}
          ids={fileIds} note={separateNote} onToggle={id => toggle(fileIds, setFileIds, id)} onMany={(ids, on) => setMany(fileIds, setFileIds, ids, on)} />

        {!hasFiles && (
          <p className="text-xs text-muted-foreground" data-testid="unit-share-no-files">No plans, brochures or photos on this unit yet. Add them in the unit's Files to include them.</p>
        )}
        <p className="text-xs text-muted-foreground" data-testid="unit-share-never-shown">The brand never sees fees, the rent floor, other offers or the Targeting Brief.</p>
      </section>

      {/* 3. How to send it */}
      <section className="space-y-3 min-w-0" data-testid="unit-share-how">
        <h3 className="text-sm font-semibold">How to send it</h3>
        {canDraft && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Pill active={mode === "pdf"} aria-pressed={mode === "pdf"} onClick={() => { setMode("pdf"); setResult(null); }} data-testid="unit-share-mode-pdf">One PDF</Pill>
            <Pill active={mode === "email"} aria-pressed={mode === "email"} onClick={() => { setMode("email"); setResult(null); }} data-testid="unit-share-mode-email">Email with attachments</Pill>
          </div>
        )}

        {mode === "pdf" || !canDraft ? (
          <p className="text-xs text-muted-foreground" data-testid="unit-share-pdf-note">
            One PDF with the details first, then the plans, brochures and photos you ticked. It is kept in this unit's sharing history.
            {!canDraft ? " Download it and attach it to your own email." : ""}
          </p>
        ) : (
          <div className="space-y-3 min-w-0">
            <p className="text-xs text-muted-foreground">
              Makes a draft in your Outlook{options.sender.email ? ` (${options.sender.email})` : ""}, addressed to {recipientEmail && emailOk ? recipientEmail : "the contact"}. You check it and press send there.
            </p>
            <div className="space-y-1">
              <Label htmlFor="unit-share-subject" className={MICRO_LABEL}>Subject</Label>
              <Input id="unit-share-subject" value={subject} maxLength={250} onChange={e => { setSubject(e.target.value); setSubjectEdited(true); }} data-testid="unit-share-subject" />
            </div>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label htmlFor="unit-share-message" className={MICRO_LABEL}>Message</Label>
                {messageEdited && (
                  <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => { setMessageEdited(false); setMessage(suggestedMessage); }} data-testid="unit-share-message-reset">
                    Use the suggested message
                  </Button>
                )}
              </div>
              <Textarea id="unit-share-message" value={message} rows={11} maxLength={10000} onChange={e => { setMessage(e.target.value); setMessageEdited(true); }} className="text-sm" data-testid="unit-share-message" />
              {messageEdited && <p className="text-xs text-muted-foreground">You have changed the message, so it no longer follows the ticks above.</p>}
            </div>
            <TickRow id="unit-share-single" checked={asSinglePdf} onChange={v => { setAsSinglePdf(v); setResult(null); }} testId="unit-share-as-single-pdf" label="Attach everything as one PDF" />
            {!asSinglePdf && fileCount > 0 && (
              <p className={cn("text-xs", separateBytes > options.emailLimitBytes ? "text-destructive" : "text-muted-foreground")} data-testid="unit-share-size-note">
                {plural(fileCount, "file")} attached one by one{separateBytes ? `, about ${fmtSize(separateBytes)}` : ""}.
                {separateBytes > options.emailLimitBytes ? ` An email takes up to ${fmtSize(options.emailLimitBytes)}: tick fewer photos, or attach everything as one PDF.` : ""}
              </p>
            )}
          </div>
        )}

        {result && (
          <div className="rounded-lg border p-3 space-y-2" role="status" data-testid={`unit-share-result-${result.kind}`}>
            {result.kind === "pdf" && (
              <>
                <p className="text-sm font-medium">PDF downloaded, {plural(result.pages, "page")}. Saved to this unit's sharing history.</p>
                <Button type="button" variant="outline" size="sm" disabled={!!downloading} onClick={() => download("result", result.url, result.fileName)} data-testid="unit-share-download-again">
                  {downloading === "result" ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1" />} Download again
                </Button>
              </>
            )}
            {result.kind === "draft" && (
              <>
                <p className="text-sm font-medium">Draft created in your Outlook. Check it and press send there.</p>
                {result.attachments.length > 0 && (
                  <p className="text-xs text-muted-foreground">Attached: {result.attachments.map(a => `${a.name} (${fmtSize(a.sizeBytes)})`).join(", ")}.</p>
                )}
                {result.webLink ? (
                  <Button asChild variant="outline" size="sm">
                    <a href={result.webLink} target="_blank" rel="noopener noreferrer" data-testid="unit-share-open-draft"><ExternalLink className="h-3.5 w-3.5 mr-1" /> Open the draft</a>
                  </Button>
                ) : <p className="text-xs text-muted-foreground">It is in your Drafts folder.</p>}
              </>
            )}
            {result.kind === "failed" && (
              <>
                <p className="text-sm font-medium">The Outlook draft could not be made.</p>
                <p className="text-xs text-muted-foreground">The PDF is ready. Download it, open an email, and attach it yourself.</p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" disabled={!!downloading} onClick={() => download("result", result.url, result.fileName)} data-testid="unit-share-fallback-download">
                    {downloading === "result" ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1" />} Download the PDF
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <a href={result.mailto} data-testid="unit-share-fallback-mailto"><Mail className="h-3.5 w-3.5 mr-1" /> Open an email</a>
                  </Button>
                </div>
              </>
            )}
            {result.skipped.length > 0 && (
              <ul className="space-y-0.5 text-xs text-muted-foreground" data-testid="unit-share-skipped">
                {result.skipped.map((s, i) => <li key={`${s.name}-${i}`} className="break-words"><span className="text-foreground">{s.name}</span>: {s.reason}.</li>)}
              </ul>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
          {blocker && <p className="text-xs text-muted-foreground" data-testid="unit-share-blocker">{blocker}</p>}
          <Button type="button" onClick={send} disabled={busy || !!blocker} data-testid="unit-share-send">
            {busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : mode === "pdf" ? <Download className="h-4 w-4 mr-1.5" /> : <Mail className="h-4 w-4 mr-1.5" />}
            {mode === "pdf" ? "Download PDF" : "Create Outlook draft"}
          </Button>
        </div>
      </section>

      {/* Shared before */}
      <section className="space-y-2 min-w-0 border-t pt-4" data-testid="unit-share-history">
        <h3 className="text-sm font-semibold">{crmPicker ? "Shared before" : "Shared by you"}</h3>
        {options.history.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="unit-share-history-empty">{crmPicker ? "Not shared with anyone yet." : "You have not shared this unit yet."} What you send from here is listed below.</p>
        ) : (
          <ul className="divide-y">
            {history.map(h => (
              <li key={h.id} className="flex items-start gap-2 py-2" data-testid={`unit-share-history-${h.id}`}>
                <div className="min-w-0 flex-1">
                  <p className="text-sm break-words">
                    <span className="font-medium">{[h.companyName || "A brand", h.contactName].filter(Boolean).join(", ")}</span>
                    <span className="text-muted-foreground whitespace-nowrap"> · {fmtDate(h.createdAt)}</span>
                  </p>
                  <p className="text-xs text-muted-foreground break-words">
                    {[h.summary, h.how, h.createdByName ? `by ${h.createdByName}` : ""].filter(Boolean).join(" · ")}
                  </p>
                </div>
                {h.draftUrl && (
                  <Button asChild variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                    <a href={h.draftUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open the Outlook draft for ${h.companyName || "this share"}`} data-testid={`unit-share-history-draft-${h.id}`}><ExternalLink className="h-4 w-4" /></a>
                  </Button>
                )}
                {h.packUrl && (
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" disabled={!!downloading} onClick={() => download(h.id, h.packUrl!, h.packFileName || "Unit details.pdf")}
                    aria-label={`Download the PDF shared with ${h.companyName || "this brand"} on ${fmtDate(h.createdAt)}`} data-testid={`unit-share-history-download-${h.id}`}>
                    {downloading === h.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {options.history.length > HISTORY_SHOWN && !showAllHistory && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setShowAllHistory(true)} data-testid="unit-share-history-show-all">Show all {options.history.length}</Button>
        )}
      </section>
    </div>
  );
}

function TickRow({ id, checked, onChange, label, side, value, note, tag, testId }: {
  id: string; checked: boolean; onChange: (v: boolean) => void; label: string; side?: ReactNode; value?: ReactNode; note?: string; tag?: string; testId: string;
}) {
  return (
    <div className="flex items-start gap-2 min-w-0">
      <Checkbox id={id} checked={checked} onCheckedChange={v => onChange(v === true)} className="mt-0.5" data-testid={testId} />
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer text-sm leading-5">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="break-words min-w-0">{label}</span>
          {tag && <span className="text-[11px] text-muted-foreground">{tag}</span>}
          {side && <span className="ml-auto min-w-0 text-right text-xs text-muted-foreground">{side}</span>}
        </span>
        {value && <span className="block text-xs text-muted-foreground">{value}</span>}
        {note && <span className="block text-[11px] text-muted-foreground">{note}</span>}
      </label>
    </div>
  );
}

function TickGroup({ title, testId, ticked, total, onAll, onNone, children }: {
  title: string; testId: string; ticked: number; total: number; onAll: () => void; onNone: () => void; children: ReactNode;
}) {
  return (
    <div className="rounded-lg border p-3 space-y-2 min-w-0" data-testid={`unit-share-group-${testId}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={MICRO_LABEL}>
          {title} <span className="font-mono tabular-nums normal-case tracking-normal" data-testid={`unit-share-count-${testId}`}>{ticked} of {total}</span>
        </p>
        {total > 1 && (
          <div className="flex items-center gap-1.5">
            <Pill onClick={onAll} disabled={ticked === total} className="disabled:opacity-50" aria-label={`Tick all ${title.toLowerCase()}`} data-testid={`unit-share-all-${testId}`}>All</Pill>
            <Pill onClick={onNone} disabled={ticked === 0} className="disabled:opacity-50" aria-label={`Untick all ${title.toLowerCase()}`} data-testid={`unit-share-none-${testId}`}>None</Pill>
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

function FileGroup({ title, testId, items, ids, note, onToggle, onMany }: {
  title: string; testId: string;
  items: { id: string; name: string; size: number | null; canMerge: boolean; tag?: string }[];
  ids: Set<string>; note: string; onToggle: (id: string) => void; onMany: (ids: string[], on: boolean) => void;
}) {
  if (items.length === 0) return null;
  const all = items.map(i => i.id);
  return (
    <TickGroup title={title} testId={testId} ticked={items.filter(i => ids.has(i.id)).length} total={items.length} onAll={() => onMany(all, true)} onNone={() => onMany(all, false)}>
      <div className="space-y-1.5">
        {items.map(i => (
          <TickRow
            key={i.id} id={`unit-share-file-${i.id}`} checked={ids.has(i.id)} onChange={() => onToggle(i.id)} testId={`unit-share-tick-file-${i.id}`}
            label={i.name} tag={i.tag}
            value={fmtSize(i.size) ? <span className="inline-flex items-center gap-1"><FileText className="h-3 w-3" aria-hidden />{fmtSize(i.size)}</span> : undefined}
            note={!i.canMerge && note ? note : undefined}
          />
        ))}
      </div>
    </TickGroup>
  );
}
