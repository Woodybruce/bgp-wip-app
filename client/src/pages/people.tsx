import { lazy, Suspense, useState, useEffect } from "react";
import { ContactDataHealth } from "@/components/contact-data-health";
import { CrmCompanyList } from "@/components/crm-hub/company-list";
import { ClientBrandList, CLIENT_BRAND_DIRECTORY_KEY, type ContactDialogTarget, type DirectoryBrand } from "@/components/crm-hub/client-brand-list";
import { StartStrategyDialog } from "@/components/crm-engagement/start-strategy";
import { ContactFormDialog } from "@/pages/contacts";
import { useRoute, useLocation, useSearch } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { User } from "@shared/schema";
import type { ClientAgentsOverview, ClientOwnContacts } from "@shared/client-agent-directory";
import { ClientAgentsDirectory, CLIENT_AGENTS_OVERVIEW_KEY } from "@/components/client-agents/client-agents-directory";
import { ClientOwnContactsTab, CLIENT_OWN_CONTACTS_KEY } from "@/components/client-agents/client-own-contacts";
import { ClipboardList, Plus } from "lucide-react";
import { CrmMeetingsTab } from "@/components/crm-meetings-tab";
import { Diary } from "@/components/brand-crm/diary";
import { CrmEngagementPanel } from "@/components/crm-engagement/overview";
import { useIsLandsecView } from "@/components/landsec/deal-clock";
import { Pill } from "@/components/ui/pill";

const CompanyDetailPage = lazy(() => import("@/pages/companies"));
const ContactDetailPage = lazy(() => import("@/pages/contacts"));

function PageLoader() {
  return (
    <div className="p-4 sm:p-6 space-y-4">
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <Skeleton key={i} className="h-32 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}

// One CRM page (Woody, 2026-11-15: "one engine ... join it all up for BGP and
// then Landsec can use that for theirs, just move lenders and landlords out").
// BGP staff: Overview, Landlords, Brands, Agents, Lenders, Diary and CRM
// Meetings, the four lists in one design (components/crm-hub). In the Landsec
// view staff get the same page without Landlords and Lenders. A client login
// gets ClientCrmHub below: Brand Directory, Agents, Diary and its own contacts.
type PeopleTab = "overview" | "landlords" | "brands" | "agents" | "lenders" | "diary" | "meetings";
const ALL_TABS: { key: PeopleTab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "landlords", label: "Landlords" },
  // Brands BGP is working, at contact level: Brand Intelligence is the full directory.
  { key: "brands", label: "Brands" },
  { key: "agents", label: "Agents" },
  { key: "lenders", label: "Lenders" },
  // Everything dated, for every kind of company.
  { key: "diary", label: "Diary" },
  { key: "meetings", label: "CRM Meetings" },
];
const LANDSEC_HIDDEN: PeopleTab[] = ["landlords", "lenders"];
const LIST_KIND = { landlords: "landlord", brands: "brand", agents: "agent", lenders: "lender" } as const;
const SUBTITLE: Record<PeopleTab, string> = {
  overview: "Events, strategies and the next steps for our relationships.",
  landlords: "Every landlord account: who owns it, when we last spoke and the next step.",
  brands: "The brands we are working: on a strategy, with an action, a live transaction or a requirement.",
  agents: "Every agent firm: who owns it, when we last spoke and the next step.",
  lenders: "Every lender: who owns it, when we last spoke and the next step.",
  diary: "Everything dated across landlords, brands, agents and lenders.",
  meetings: "This week's meetings and the head-of-team interviews.",
};

export default function PeoplePage() {
  const [, companyParams] = useRoute("/companies/:id");
  const [, contactParams] = useRoute("/contacts/:id");
  const { data: user, isLoading: userLoading } = useQuery<User>({ queryKey: ["/api/auth/me"] });

  if (companyParams?.id) {
    return (
      <Suspense fallback={<PageLoader />}>
        <CompanyDetailPage />
      </Suspense>
    );
  }

  if (contactParams?.id) {
    return (
      <Suspense fallback={<PageLoader />}>
        <ContactDetailPage />
      </Suspense>
    );
  }

  // Client logins (e.g. Landsec) get the client's CRM: the brands on its
  // list, the agents, the diary and the people at its own company. BGP's
  // landlords, lenders, strategies and owners are BGP's own.
  if (userLoading) return <PageLoader />;
  if (user?.role === "Client" || !!(user as any)?.companyScopeId) return <ClientCrmHub />;

  return <PeopleHub />;
}

// ── A client login's CRM: Brand Directory, Agents, Diary, its own people ─────────────
type ClientTab = "brands" | "agents" | "diary" | "contacts";

function ClientCrmHub() {
  const landsec = useIsLandsecView();
  const [tab, setTab] = useState<ClientTab>(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    return requested === "agents" || requested === "contacts" || (requested === "diary" && landsec) ? requested : "brands";
  });
  const chooseTab = (next: ClientTab) => {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  };
  const [contactDialog, setContactDialog] = useState<ContactDialogTarget | null>(null);

  const { data: hubUser } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const { data: brands = [] } = useQuery<DirectoryBrand[]>({ queryKey: CLIENT_BRAND_DIRECTORY_KEY });
  // The people at the client's own company only (Woody, 2026-11-12). The
  // wider contact list the login may read is not loaded here: brand
  // contacts are on the Brand Directory tab and agents on the Agents tab.
  const { data: ownData, isLoading: ownLoading, isError: ownError } = useQuery<ClientOwnContacts>({ queryKey: CLIENT_OWN_CONTACTS_KEY });
  const clientName = hubUser?.companyScopeName || hubUser?.team || ownData?.companyName || "";
  const ownPeopleCount = ownData?.peopleCount || 0;
  const { data: agentData, isLoading: agentsLoading, isError: agentsError } = useQuery<ClientAgentsOverview>({ queryKey: CLIENT_AGENTS_OVERVIEW_KEY });
  const agentFirmCount = (agentData?.bgp.length ? 1 : 0) + (agentData?.jointAgents.filter(firm => firm.name).length || 0) + (agentData?.tenantReps.filter(agent => agent.kind === "firm").length || 0);
  const namedAgentCount = (agentData?.bgp.length || 0)
    + (agentData?.jointAgents.reduce((n, firm) => n + firm.people.length, 0) || 0)
    + new Set((agentData?.tenantReps || []).flatMap(agent => agent.contacts.map(contact => contact.id))).size;
  const tabs: Array<{ key: ClientTab; label: string }> = [
    // "Brand Directory", not "Brands": a Landsec side bar already has Brands (Brand Intelligence).
    { key: "brands", label: "Brand Directory" }, { key: "agents", label: "Agents" },
    // The diary is the Landsec workspace's: other clients have none.
    ...(landsec ? [{ key: "diary" as const, label: "Diary" }] : []),
    { key: "contacts", label: `${clientName || "Your"} Contacts` },
  ];

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1600px] mx-auto" data-testid="client-crm-hub">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">CRM</h1>
        <p className="text-sm text-muted-foreground">
          <span className="font-mono tabular-nums">{brands.length.toLocaleString("en-GB")}</span> brands · {agentsLoading ? "Agents loading" : agentsError && !agentData ? "Agents unavailable" : <><span className="font-mono tabular-nums">{agentFirmCount.toLocaleString("en-GB")}</span> agent {agentFirmCount === 1 ? "firm" : "firms"} · <span className="font-mono tabular-nums">{namedAgentCount.toLocaleString("en-GB")}</span> named {namedAgentCount === 1 ? "agent" : "agents"}</>} · <span data-testid="client-crm-own-count">{ownLoading ? "People loading" : ownError && !ownData ? "Your people unavailable" : <><span className="font-mono tabular-nums">{ownPeopleCount.toLocaleString("en-GB")}</span> {ownPeopleCount === 1 ? "person" : "people"} at {clientName || "your company"}</>}</span>
        </p>
      </div>

      {/* One sideways-scrolling row on the phone rather than wrapping. */}
      <div className="flex gap-1.5 flex-nowrap overflow-x-auto pb-1 md:flex-wrap md:overflow-visible md:pb-0 [&>*]:shrink-0">
        {tabs.map(t => <Pill key={t.key} active={tab === t.key} onClick={() => chooseTab(t.key)} data-testid={`client-crm-tab-${t.key}`}>{t.label}</Pill>)}
      </div>

      {tab === "brands" ? (
        <ClientBrandList landsec={landsec} onContact={setContactDialog} />
      ) : tab === "agents" ? (
        <ClientAgentsDirectory />
      ) : tab === "diary" && landsec ? (
        <Diary staff={false} />
      ) : (
        <ClientOwnContactsTab
          clientName={clientName || "your company"}
          onAdd={hubUser?.companyScopeId ? () => setContactDialog({ companyId: hubUser.companyScopeId, companyName: clientName || "Your company" }) : undefined}
          onEdit={person => setContactDialog({
            companyId: person.companyId || hubUser?.companyScopeId,
            companyName: person.company || clientName || "Your company",
            contact: { id: person.contactId, name: person.record?.name ?? person.name, role: person.record ? person.record.title : person.title, email: person.record ? person.record.email : person.email, phoneMobile: person.record ? person.record.phone : person.phone },
          })}
          onAddDetails={hubUser?.companyScopeId ? person => setContactDialog({
            companyId: hubUser.companyScopeId, companyName: clientName || "Your company", contact: { name: person.name },
          }) : undefined}
        />
      )}

      {contactDialog && (
        <ContactQuickDialog
          companyId={contactDialog.companyId}
          companyName={contactDialog.companyName}
          contact={contactDialog.contact}
          onClose={() => setContactDialog(null)}
        />
      )}
    </div>
  );
}

function ContactQuickDialog({ companyId, companyName, contact, onClose }: {
  companyId: string;
  companyName: string;
  contact?: any;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(contact?.name || "");
  const [role, setRole] = useState(contact?.role || "");
  const [email, setEmail] = useState(contact?.email || "");
  const [phone, setPhone] = useState(contact?.phoneMobile || contact?.phone || "");

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        name: name.trim(),
        role: role.trim() || null,
        email: email.trim() || null,
        phoneMobile: phone.trim() || null,
        companyId,
      };
      if (contact?.id) {
        return apiRequest("PUT", `/api/crm/contacts/${contact.id}`, body);
      }
      return apiRequest("POST", "/api/crm/contacts", body);
    },
    onSuccess: () => {
      toast({ title: contact?.id ? "Contact updated" : "Contact added" });
      queryClient.invalidateQueries({ queryKey: ["/api/client/brand-directory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/contacts"] });
      queryClient.invalidateQueries({ queryKey: CLIENT_OWN_CONTACTS_KEY });
      onClose();
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{contact?.id ? "Edit contact" : "Add contact"} — {companyName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cq-name">Name</Label>
            <Input id="cq-name" value={name} onChange={e => setName(e.target.value)} placeholder="Full name" data-testid="contact-dialog-name" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cq-role">Role</Label>
            <Input id="cq-role" value={role} onChange={e => setRole(e.target.value)} placeholder="e.g. Head of Acquisitions" data-testid="contact-dialog-role" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cq-email">Email</Label>
            <Input id="cq-email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@company.com" data-testid="contact-dialog-email" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cq-phone">Phone</Label>
            <Input id="cq-phone" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+44…" data-testid="contact-dialog-phone" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={!name.trim() || saveMutation.isPending}
            data-testid="contact-dialog-save"
          >
            {saveMutation.isPending ? "Saving…" : contact?.id ? "Save changes" : "Add contact"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── BGP's CRM page ──────────────────────────────────────────────────────────
function PeopleHub() {
  const urlSearch = useSearch();
  const [, navigate] = useLocation();
  // In the Landsec view (the team picker on Landsec) the page is the same
  // without Landlords and Lenders.
  const landsec = useIsLandsecView();
  const tabs = landsec ? ALL_TABS.filter(t => !LANDSEC_HIDDEN.includes(t.key)) : ALL_TABS;
  const allowed = (value: string | null): value is PeopleTab => tabs.some(t => t.key === value);

  const [tab, setTab] = useState<PeopleTab>(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    return allowed(requested) ? requested : "overview";
  });
  const chooseTab = (next: PeopleTab) => {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    ["event", "strategy", "action"].forEach(key => url.searchParams.delete(key));
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  };
  useEffect(() => {
    const requested = new URLSearchParams(urlSearch).get("tab");
    if (allowed(requested)) setTab(requested);
  }, [urlSearch, landsec]);
  // A tab the Landsec view does not have falls back to the Overview.
  useEffect(() => { if (!tabs.some(t => t.key === tab)) setTab("overview"); }, [landsec]);
  // Start strategy: turning a company on (the kick-off dialog), from any list.
  const [startFor, setStartFor] = useState<{ id: string; name: string } | null>(null);
  const openStrategy = (strategyId: string) => navigate(`/contacts?tab=overview&strategy=${encodeURIComponent(strategyId)}`);
  const [hubAddContactOpen, setHubAddContactOpen] = useState(false);
  const listKind = tab in LIST_KIND ? LIST_KIND[tab as keyof typeof LIST_KIND] : null;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* Wraps on phones — the subtitle squeezed into a one-word column and
          pushed the buttons off-screen (Woody, 2026-09-27). */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">CRM</h1>
          <p className="text-sm text-muted-foreground">{SUBTITLE[tab]}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Header shortcut to the meetings tab — the pill alone was too
              easy to miss (Carly, 2026-09-21: "it needs to be way clearer"). */}
          <Button size="sm" variant="outline" onClick={() => chooseTab("meetings")} data-testid="button-crm-meetings">
            <ClipboardList className="w-4 h-4 mr-1" /> CRM Meetings
          </Button>
          <Button variant="outline" size="sm" onClick={() => setHubAddContactOpen(true)} data-testid="button-hub-add-contact">
            <Plus className="w-4 h-4 mr-1" /> Add contact
          </Button>
        </div>
      </div>
      <ContactFormDialog open={hubAddContactOpen} onOpenChange={setHubAddContactOpen} />

      {/* One sideways-scrolling row on the phone rather than wrapping. */}
      <div className="flex gap-1.5 flex-nowrap overflow-x-auto pb-1 md:flex-wrap md:overflow-visible md:pb-0 [&>*]:shrink-0">
        {tabs.map((t) => (
          <Pill key={t.key} active={tab === t.key} onClick={() => chooseTab(t.key)} data-testid={`tab-${t.key}`}>
            {t.label}
          </Pill>
        ))}
        {/* The employer checks queue: a pill at the end of the row, beside CRM Meetings. */}
        <ContactDataHealth pill />
      </div>

      {/* One list design for every kind (Woody, 2026-11-15). */}
      {listKind && <CrmCompanyList kind={listKind} onStartStrategy={row => setStartFor({ id: row.id, name: row.name })} onOpenStrategy={openStrategy} />}
      {tab === "overview" && <CrmEngagementPanel kind="all" />}
      {tab === "diary" && <Diary staff scope="all" />}
      {tab === "meetings" && <CrmMeetingsTab />}

      {startFor && <StartStrategyDialog company={startFor} onClose={() => setStartFor(null)} onStarted={openStrategy} />}
    </div>
  );
}
