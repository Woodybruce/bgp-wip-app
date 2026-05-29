import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Users, Pencil, Plus, X, UserPlus, Cake, Trash2, Folder, FolderLock, Save } from "lucide-react";
import { PageLayout } from "@/components/page-layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, getQueryFn } from "@/lib/queryClient";
import type { User } from "@shared/schema";

type Person = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  team: string | null;
  additional_teams: string[] | null;
  profile_pic_url: string | null;
  manager_id: string | null;
  board_member: boolean | null;
  management_team: boolean | null;
  display_order: number | null;
  wfh_days: string[] | null;
  bio: string | null;
  cv_url: string | null;
  is_active: boolean | null;
  // Private tier — only present for self / admins
  dob?: string | null;
  address?: string | null;
  personal_email?: string | null;
  employment_type?: string | null;
  start_date?: string | null;
};

type Birthday = {
  id: string;
  name: string;
  role: string | null;
  team: string | null;
  profilePicUrl: string | null;
  date: string;
  daysUntil: number;
};

const TEAM_ORDER = [
  "Office / Corporate",
  "Investment",
  "Lease Advisory",
  "National Leasing",
  "Development",
  "Tenant Rep",
  "London Leasing",
];

// Card colours mirror Layla's organigram. Each tuple = [bg, border, text].
const TEAM_STYLES: Record<string, { bg: string; border: string; text: string; pip: string }> = {
  "Office / Corporate": { bg: "bg-purple-50 dark:bg-purple-950/30", border: "border-purple-200 dark:border-purple-800", text: "text-purple-900 dark:text-purple-100", pip: "bg-purple-500" },
  "Investment":          { bg: "bg-emerald-50 dark:bg-emerald-950/30", border: "border-emerald-200 dark:border-emerald-800", text: "text-emerald-900 dark:text-emerald-100", pip: "bg-emerald-500" },
  "Lease Advisory":      { bg: "bg-amber-50 dark:bg-amber-950/30", border: "border-amber-200 dark:border-amber-800", text: "text-amber-900 dark:text-amber-100", pip: "bg-amber-500" },
  "National Leasing":    { bg: "bg-orange-50 dark:bg-orange-950/30", border: "border-orange-200 dark:border-orange-800", text: "text-orange-900 dark:text-orange-100", pip: "bg-orange-500" },
  "Development":         { bg: "bg-pink-50 dark:bg-pink-950/30", border: "border-pink-200 dark:border-pink-800", text: "text-pink-900 dark:text-pink-100", pip: "bg-pink-500" },
  "Tenant Rep":          { bg: "bg-sky-50 dark:bg-sky-950/30", border: "border-sky-200 dark:border-sky-800", text: "text-sky-900 dark:text-sky-100", pip: "bg-sky-500" },
  "London Leasing":      { bg: "bg-yellow-50 dark:bg-yellow-950/30", border: "border-yellow-200 dark:border-yellow-800", text: "text-yellow-900 dark:text-yellow-100", pip: "bg-yellow-500" },
};
const DEFAULT_STYLE = { bg: "bg-muted", border: "border-border", text: "text-foreground", pip: "bg-gray-500" };

function styleForTeam(team: string | null | undefined) {
  if (!team) return DEFAULT_STYLE;
  return TEAM_STYLES[team] || DEFAULT_STYLE;
}

function initials(name: string) {
  return name.split(/\s+/).map(p => p[0]).join("").slice(0, 2).toUpperCase();
}

function PersonCard({ person, onClick, compact }: { person: Person; onClick: () => void; compact?: boolean }) {
  const style = styleForTeam(person.team);
  return (
    <button
      onClick={onClick}
      className={`relative w-44 rounded-lg border-2 ${style.bg} ${style.border} ${style.text} p-2 text-left shadow-sm hover:shadow-md hover:scale-[1.02] transition-all cursor-pointer`}
      data-testid={`card-person-${person.id}`}
    >
      <div className="flex items-start gap-2">
        <Avatar className="w-9 h-9 shrink-0 border bg-white">
          <AvatarImage src={person.profile_pic_url || undefined} alt={person.name} />
          <AvatarFallback className="text-xs">{initials(person.name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold leading-tight truncate">{person.name}</p>
          {!compact && <p className="text-[10px] opacity-75 leading-tight mt-0.5 line-clamp-2">{person.role || "—"}</p>}
        </div>
      </div>
      {(person.board_member || person.management_team) && (
        <div className="absolute -top-1.5 -right-1.5 flex gap-0.5">
          {person.board_member && (
            <span className="text-[8px] font-bold bg-black text-white px-1 py-0.5 rounded shadow">BOARD</span>
          )}
          {person.management_team && !person.board_member && (
            <span className="text-[8px] font-bold bg-slate-700 text-white px-1 py-0.5 rounded shadow">MGT</span>
          )}
        </div>
      )}
    </button>
  );
}

// Recursively render a subordinate column. Each level draws a vertical
// connector to its parent and stacks children below.
function ChainNode({ person, childrenByManager, onSelect }: { person: Person; childrenByManager: Map<string, Person[]>; onSelect: (p: Person) => void }) {
  const directs = childrenByManager.get(person.id) || [];
  return (
    <div className="flex flex-col items-center">
      <PersonCard person={person} onClick={() => onSelect(person)} />
      {directs.length > 0 && (
        <>
          <div className="w-px h-4 bg-border" />
          <div className="flex flex-col items-center gap-4">
            {directs.map(child => (
              <ChainNode key={child.id} person={child} childrenByManager={childrenByManager} onSelect={onSelect} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function OrgChart({ people, onSelect }: { people: Person[]; onSelect: (p: Person) => void }) {
  const root = useMemo(() => people.find(p => !p.manager_id) || null, [people]);
  const childrenByManager = useMemo(() => {
    const map = new Map<string, Person[]>();
    for (const p of people) {
      if (!p.manager_id) continue;
      const list = map.get(p.manager_id) || [];
      list.push(p);
      map.set(p.manager_id, list);
    }
    // Within a sibling group, sort by team-column order then displayOrder.
    for (const list of map.values()) {
      list.sort((a, b) => {
        const ta = TEAM_ORDER.indexOf(a.team || "");
        const tb = TEAM_ORDER.indexOf(b.team || "");
        if (ta !== tb) return ta - tb;
        return (a.display_order ?? 0) - (b.display_order ?? 0);
      });
    }
    return map;
  }, [people]);

  if (!root) {
    return <p className="text-sm text-muted-foreground">No managing director set. The person at the top of the chart should have no manager.</p>;
  }

  // Group root's direct reports into team columns so Office/Corporate's 5 PAs
  // stack inside a single column rather than spawning 5 sibling columns.
  const directs = childrenByManager.get(root.id) || [];
  const columnGroups = TEAM_ORDER
    .map(team => ({ team, members: directs.filter(p => p.team === team) }))
    .filter(g => g.members.length > 0);
  const otherDirects = directs.filter(p => !TEAM_ORDER.includes(p.team || ""));
  if (otherDirects.length > 0) columnGroups.push({ team: "Other", members: otherDirects });

  return (
    <div className="flex flex-col items-center min-w-max">
      <PersonCard person={root} onClick={() => onSelect(root)} />
      {columnGroups.length > 0 && (
        <>
          <div className="w-px h-6 bg-border" />
          <div className="flex items-start gap-6">
            {columnGroups.map(group => {
              const style = styleForTeam(group.team);
              return (
                <div key={group.team} className="flex flex-col items-center">
                  <div className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded border ${style.bg} ${style.border} ${style.text} mb-2`}>
                    {group.team}
                  </div>
                  <div className="flex flex-col items-center gap-4">
                    {group.members.map(member => (
                      <ChainNode key={member.id} person={member} childrenByManager={childrenByManager} onSelect={onSelect} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Orphans: any active person whose manager is missing/inactive — surface
          them so admins can re-link. */}
      <Orphans people={people} root={root} childrenByManager={childrenByManager} onSelect={onSelect} />
    </div>
  );
}

function Orphans({ people, root, childrenByManager, onSelect }: { people: Person[]; root: Person; childrenByManager: Map<string, Person[]>; onSelect: (p: Person) => void }) {
  const reachable = useMemo(() => {
    const set = new Set<string>([root.id]);
    const queue = [root.id];
    while (queue.length) {
      const id = queue.shift()!;
      for (const child of childrenByManager.get(id) || []) {
        if (!set.has(child.id)) { set.add(child.id); queue.push(child.id); }
      }
    }
    return set;
  }, [root, childrenByManager]);

  const orphans = people.filter(p => !reachable.has(p.id));
  if (orphans.length === 0) return null;

  return (
    <div className="mt-12 pt-6 border-t w-full">
      <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Unassigned ({orphans.length})</p>
      <div className="flex flex-wrap gap-3">
        {orphans.map(p => <PersonCard key={p.id} person={p} onClick={() => onSelect(p)} />)}
      </div>
    </div>
  );
}

function BirthdaysWidget() {
  const { data: birthdays = [] } = useQuery<Birthday[]>({
    queryKey: ["/api/hr/birthdays"],
  });
  if (birthdays.length === 0) return null;

  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-2 mb-2">
        <Cake className="w-4 h-4 text-pink-500" />
        <p className="text-sm font-semibold">Upcoming birthdays</p>
      </div>
      <div className="space-y-1.5">
        {birthdays.slice(0, 5).map(b => (
          <div key={b.id} className="flex items-center gap-2 text-xs">
            <Avatar className="w-6 h-6 border">
              <AvatarImage src={b.profilePicUrl || undefined} />
              <AvatarFallback className="text-[10px]">{initials(b.name)}</AvatarFallback>
            </Avatar>
            <span className="font-medium truncate flex-1">{b.name}</span>
            <span className="text-muted-foreground shrink-0">
              {b.daysUntil === 0 ? "Today!" : b.daysUntil === 1 ? "Tomorrow" : `${b.daysUntil} days`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProfileDrawer({
  person,
  open,
  onClose,
  currentUser,
  allPeople,
}: {
  person: Person | null;
  open: boolean;
  onClose: () => void;
  currentUser: User | null;
  allPeople: Person[];
}) {
  const { toast } = useToast();
  const isAdmin = !!currentUser?.isAdmin;
  const isSelf = !!person && person.id === currentUser?.id;
  const canEdit = isAdmin || isSelf;
  const showPrivate = isAdmin || isSelf;
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState<Partial<Person>>({});

  // Reset draft when opening on a new person.
  useEffect(() => {
    setDraft(person || {});
    setEdit(false);
  }, [person?.id]);

  const save = useMutation({
    mutationFn: async (patch: Record<string, any>) => {
      if (!person) return;
      return apiRequest("PATCH", `/api/hr/team/${person.id}`, patch);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hr/team"] });
      queryClient.invalidateQueries({ queryKey: ["/api/hr/birthdays"] });
      toast({ title: "Profile updated" });
      setEdit(false);
    },
    onError: (e: any) => toast({ title: "Update failed", description: e?.message || "Try again", variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async () => {
      if (!person) return;
      return apiRequest("DELETE", `/api/hr/team/${person.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hr/team"] });
      toast({ title: "Removed from org chart" });
      onClose();
    },
    onError: (e: any) => toast({ title: "Remove failed", description: e?.message || "Try again", variant: "destructive" }),
  });

  if (!person) return null;
  const style = styleForTeam(person.team);
  const managerName = person.manager_id ? allPeople.find(p => p.id === person.manager_id)?.name : null;
  const directReports = allPeople.filter(p => p.manager_id === person.id);

  const buildPatch = () => {
    const patch: Record<string, any> = {};
    const fields = isAdmin
      ? ["name", "email", "phone", "role", "team", "managerId", "boardMember", "managementTeam", "dob", "address", "personalEmail", "wfhDays", "employmentType", "startDate", "cvUrl", "bio"]
      : ["phone", "dob", "address", "personalEmail", "wfhDays", "cvUrl", "bio"];
    for (const f of fields) {
      const draftKey = f as keyof Person;
      const personKey = f.replace(/[A-Z]/g, c => "_" + c.toLowerCase()) as keyof Person;
      const newVal = (draft as any)[draftKey] ?? (draft as any)[personKey];
      const oldVal = (person as any)[personKey];
      if (newVal !== undefined && newVal !== oldVal) {
        patch[f] = newVal === "" ? null : newVal;
      }
    }
    return patch;
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-left">Profile</SheetTitle>
        </SheetHeader>

        <div className={`mt-4 rounded-lg border-2 ${style.bg} ${style.border} p-4`}>
          <div className="flex items-start gap-3">
            <Avatar className="w-16 h-16 border-2 bg-white">
              <AvatarImage src={person.profile_pic_url || undefined} />
              <AvatarFallback>{initials(person.name)}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-lg font-bold leading-tight">{person.name}</p>
              <p className="text-sm opacity-80">{person.role || "—"}</p>
              <div className="flex flex-wrap gap-1 mt-1.5">
                {person.team && <Badge variant="secondary" className="text-[10px]">{person.team}</Badge>}
                {person.board_member && <Badge className="text-[10px] bg-black text-white">BOARD</Badge>}
                {person.management_team && <Badge variant="outline" className="text-[10px]">MGT</Badge>}
                {(person.additional_teams || []).map(t => (
                  <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>
                ))}
              </div>
            </div>
          </div>
        </div>

        {canEdit && (
          <div className="mt-3 flex items-center justify-end gap-2">
            {!edit ? (
              <Button size="sm" variant="outline" onClick={() => setEdit(true)} data-testid="button-edit-profile">
                <Pencil className="w-3.5 h-3.5 mr-1.5" /> Edit
              </Button>
            ) : (
              <>
                <Button size="sm" variant="ghost" onClick={() => { setDraft(person); setEdit(false); }}>Cancel</Button>
                <Button size="sm" onClick={() => save.mutate(buildPatch())} disabled={save.isPending}>
                  <Save className="w-3.5 h-3.5 mr-1.5" /> {save.isPending ? "Saving…" : "Save"}
                </Button>
              </>
            )}
          </div>
        )}

        {/* Visible-to-team section */}
        <Section title="Team-visible">
          <Field label="Email" value={person.email} edit={edit && isAdmin} onChange={v => setDraft({ ...draft, email: v })} draftValue={draft.email} />
          <Field label="Phone" value={person.phone} edit={edit && canEdit} onChange={v => setDraft({ ...draft, phone: v })} draftValue={draft.phone} />
          <Field label="Role" value={person.role} edit={edit && isAdmin} onChange={v => setDraft({ ...draft, role: v })} draftValue={draft.role} />
          {edit && isAdmin ? (
            <div className="grid grid-cols-3 gap-2 py-1.5">
              <Label className="text-xs text-muted-foreground self-center">Team</Label>
              <Select value={(draft.team ?? person.team) || ""} onValueChange={v => setDraft({ ...draft, team: v })}>
                <SelectTrigger className="col-span-2 h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{TEAM_ORDER.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          ) : (
            <Field label="Team" value={person.team} />
          )}
          {edit && isAdmin ? (
            <div className="grid grid-cols-3 gap-2 py-1.5">
              <Label className="text-xs text-muted-foreground self-center">Reports to</Label>
              <Select value={(draft.manager_id ?? person.manager_id) || "none"} onValueChange={v => setDraft({ ...draft, manager_id: v === "none" ? null : v })}>
                <SelectTrigger className="col-span-2 h-8 text-sm"><SelectValue placeholder="Select manager" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— None (top of chart) —</SelectItem>
                  {allPeople.filter(p => p.id !== person.id).map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <Field label="Reports to" value={managerName} />
          )}
          {edit && isAdmin && (
            <>
              <ToggleField label="Board member" value={!!(draft.board_member ?? person.board_member)} onChange={v => setDraft({ ...draft, board_member: v })} />
              <ToggleField label="Management team" value={!!(draft.management_team ?? person.management_team)} onChange={v => setDraft({ ...draft, management_team: v })} />
            </>
          )}
          <Field label="WFH days" value={(person.wfh_days || []).join(", ") || null} edit={edit && canEdit} onChange={v => setDraft({ ...draft, wfh_days: v ? v.split(",").map(s => s.trim()).filter(Boolean) : [] })} draftValue={(draft.wfh_days || person.wfh_days || []).join(", ")} placeholder="Mon, Wed, Fri" />
          <Field label="Bio" value={person.bio} multiline edit={edit && canEdit} onChange={v => setDraft({ ...draft, bio: v })} draftValue={draft.bio} />
          <Field label="CV link" value={person.cv_url} edit={edit && canEdit} onChange={v => setDraft({ ...draft, cv_url: v })} draftValue={draft.cv_url} />
          {directReports.length > 0 && (
            <div className="py-1.5">
              <p className="text-xs text-muted-foreground mb-1">Direct reports ({directReports.length})</p>
              <div className="flex flex-wrap gap-1">
                {directReports.map(r => <Badge key={r.id} variant="outline" className="text-[10px]">{r.name}</Badge>)}
              </div>
            </div>
          )}
        </Section>

        {/* Personal-tier — gated to self + admins */}
        {showPrivate ? (
          <Section title="Personal">
            <Field label="Date of birth" value={person.dob} edit={edit && canEdit} onChange={v => setDraft({ ...draft, dob: v })} draftValue={draft.dob} placeholder="YYYY-MM-DD" />
            <Field label="Address" value={person.address} multiline edit={edit && canEdit} onChange={v => setDraft({ ...draft, address: v })} draftValue={draft.address} />
            <Field label="Personal email" value={person.personal_email} edit={edit && canEdit} onChange={v => setDraft({ ...draft, personal_email: v })} draftValue={draft.personal_email} />
            <Field label="Employment type" value={person.employment_type} edit={edit && isAdmin} onChange={v => setDraft({ ...draft, employment_type: v })} draftValue={draft.employment_type} placeholder="FT / PT / Mat / Contract" />
            <Field label="Start date" value={person.start_date} edit={edit && isAdmin} onChange={v => setDraft({ ...draft, start_date: v })} draftValue={draft.start_date} placeholder="YYYY-MM-DD" />
          </Section>
        ) : (
          <Section title="Personal">
            <p className="text-xs text-muted-foreground italic">Personal details are visible only to {person.name.split(" ")[0]} and Admins.</p>
          </Section>
        )}

        {/* Documents — stub UI; SharePoint wiring lands in a follow-up. */}
        <Section title="Documents">
          <DocFolder icon={<Folder className="w-4 h-4" />} label="Personal" hint={isSelf ? "Visible to you and Admins" : isAdmin ? "Visible to this person and Admins" : "Locked"} locked={!showPrivate} />
          <DocFolder icon={<FolderLock className="w-4 h-4" />} label="Admin only" hint="Visible to Admins only" locked={!isAdmin} />
          <p className="text-[10px] text-muted-foreground mt-2 italic">Folders connect to SharePoint in the next release. Permissions are enforced at the SharePoint level.</p>
        </Section>

        {isAdmin && !isSelf && (
          <div className="mt-6 pt-4 border-t">
            <RemoveButton onConfirm={() => remove.mutate()} pending={remove.isPending} name={person.name} />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5 font-semibold">{title}</p>
      <div className="rounded-md border divide-y">{children}</div>
    </div>
  );
}

function Field({ label, value, multiline, edit, onChange, draftValue, placeholder }: { label: string; value: string | null | undefined; multiline?: boolean; edit?: boolean; onChange?: (v: string) => void; draftValue?: any; placeholder?: string }) {
  if (edit) {
    const v = draftValue ?? value ?? "";
    return (
      <div className="grid grid-cols-3 gap-2 px-3 py-2">
        <Label className="text-xs text-muted-foreground self-center">{label}</Label>
        {multiline ? (
          <Textarea className="col-span-2 text-sm min-h-[64px]" value={v} placeholder={placeholder} onChange={e => onChange?.(e.target.value)} />
        ) : (
          <Input className="col-span-2 h-8 text-sm" value={v} placeholder={placeholder} onChange={e => onChange?.(e.target.value)} />
        )}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-3 gap-2 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="col-span-2 text-sm break-words">{value || <span className="text-muted-foreground italic">—</span>}</p>
    </div>
  );
}

function ToggleField({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between px-3 py-2">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Switch checked={value} onCheckedChange={onChange} />
    </div>
  );
}

function DocFolder({ icon, label, hint, locked }: { icon: React.ReactNode; label: string; hint: string; locked: boolean }) {
  return (
    <div className={`flex items-center gap-2 px-3 py-2 ${locked ? "opacity-50" : ""}`}>
      {icon}
      <div className="flex-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-[10px] text-muted-foreground">{hint}</p>
      </div>
      <Badge variant="outline" className="text-[10px]">Coming soon</Badge>
    </div>
  );
}

function RemoveButton({ onConfirm, pending, name }: { onConfirm: () => void; pending: boolean; name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
        <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Remove from chart
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {name}?</AlertDialogTitle>
            <AlertDialogDescription>
              They will be deactivated and disappear from the org chart. Their direct reports become unassigned and you can re-link them. The user record itself is kept — nothing is permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirm} disabled={pending}>{pending ? "Removing…" : "Remove"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function AddPersonDialog({ open, onClose, allPeople }: { open: boolean; onClose: () => void; allPeople: Person[] }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [team, setTeam] = useState("");
  const [managerId, setManagerId] = useState<string>("none");
  const [email, setEmail] = useState("");
  const [boardMember, setBoardMember] = useState(false);
  const [managementTeam, setManagementTeam] = useState(false);

  const create = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/hr/team", {
      name: name.trim(),
      role: role.trim() || null,
      team: team || null,
      managerId: managerId === "none" ? null : managerId,
      email: email.trim() || null,
      boardMember,
      managementTeam,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hr/team"] });
      toast({ title: `Added ${name}` });
      setName(""); setRole(""); setTeam(""); setManagerId("none"); setEmail(""); setBoardMember(false); setManagementTeam(false);
      onClose();
    },
    onError: (e: any) => toast({ title: "Add failed", description: e?.message || "Try again", variant: "destructive" }),
  });

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Add person</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-3">
          <div>
            <Label className="text-xs">Full name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Jane Smith" />
          </div>
          <div>
            <Label className="text-xs">Role</Label>
            <Input value={role} onChange={e => setRole(e.target.value)} placeholder="Surveyor – London Leasing" />
          </div>
          <div>
            <Label className="text-xs">Team</Label>
            <Select value={team} onValueChange={setTeam}>
              <SelectTrigger><SelectValue placeholder="Choose team" /></SelectTrigger>
              <SelectContent>{TEAM_ORDER.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Reports to</Label>
            <Select value={managerId} onValueChange={setManagerId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— None (top of chart) —</SelectItem>
                {allPeople.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Work email</Label>
            <Input value={email} onChange={e => setEmail(e.target.value)} placeholder="jane@bgpcommercial.com" />
          </div>
          <div className="flex items-center justify-between pt-2">
            <Label className="text-xs">Board member</Label>
            <Switch checked={boardMember} onCheckedChange={setBoardMember} />
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-xs">Management team</Label>
            <Switch checked={managementTeam} onCheckedChange={setManagementTeam} />
          </div>
          <Button className="w-full mt-3" onClick={() => create.mutate()} disabled={!name.trim() || create.isPending}>
            {create.isPending ? "Adding…" : "Add to chart"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function EmptyState({ isAdmin, onSeed, seeding }: { isAdmin: boolean; onSeed: () => void; seeding: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <Users className="w-12 h-12 text-muted-foreground mb-3" />
      <h3 className="text-lg font-semibold">No team yet</h3>
      <p className="text-sm text-muted-foreground max-w-md mt-1">
        The org chart is empty. {isAdmin ? "Seed the BGP roster to get started, or add people one at a time." : "An admin needs to seed the BGP roster."}
      </p>
      {isAdmin && (
        <Button className="mt-4" onClick={onSeed} disabled={seeding}>
          <UserPlus className="w-4 h-4 mr-2" />
          {seeding ? "Seeding…" : "Seed BGP team"}
        </Button>
      )}
    </div>
  );
}

export default function TeamPage() {
  const { toast } = useToast();
  const { data: currentUser } = useQuery<User | null>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });
  const isAdmin = !!currentUser?.isAdmin;

  const { data: people = [], isLoading } = useQuery<Person[]>({ queryKey: ["/api/hr/team"] });

  const [selected, setSelected] = useState<Person | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [teamFilter, setTeamFilter] = useState<string>("all");

  const seed = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/seed-team");
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/hr/team"] });
      toast({ title: "BGP team seeded", description: `${data?.inserted ?? 0} added, ${data?.updated ?? 0} updated.` });
    },
    onError: (e: any) => toast({ title: "Seed failed", description: e?.message || "Try again", variant: "destructive" }),
  });

  const filtered = useMemo(() => {
    if (teamFilter === "all") return people;
    return people.filter(p => p.team === teamFilter || (p.additional_teams || []).includes(teamFilter));
  }, [people, teamFilter]);

  const openProfile = (p: Person) => { setSelected(p); setDrawerOpen(true); };

  return (
    <PageLayout
      title="Org Chart"
      subtitle="Org chart, profiles and HR records"
      icon={Users}
      testId="page-team"
      actions={
        <>
          <BirthdaysQuickPip />
          {isAdmin && (
            <Button size="sm" onClick={() => setAddOpen(true)} data-testid="button-add-person">
              <Plus className="w-3.5 h-3.5 mr-1.5" /> Add person
            </Button>
          )}
        </>
      }
    >
      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-10 w-64" />
          <div className="flex gap-3"><Skeleton className="h-32 w-44" /><Skeleton className="h-32 w-44" /><Skeleton className="h-32 w-44" /></div>
        </div>
      ) : people.length === 0 ? (
        <EmptyState isAdmin={isAdmin} onSeed={() => seed.mutate()} seeding={seed.isPending} />
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 text-xs">
              <button
                onClick={() => setTeamFilter("all")}
                className={`px-2.5 py-1 rounded-full border ${teamFilter === "all" ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-accent"}`}
              >
                All ({people.length})
              </button>
              {TEAM_ORDER.map(t => {
                const count = people.filter(p => p.team === t || (p.additional_teams || []).includes(t)).length;
                if (count === 0) return null;
                const style = TEAM_STYLES[t];
                return (
                  <button
                    key={t}
                    onClick={() => setTeamFilter(t)}
                    className={`px-2.5 py-1 rounded-full border flex items-center gap-1.5 ${teamFilter === t ? `${style.bg} ${style.border} font-semibold` : "bg-card hover:bg-accent"}`}
                  >
                    <span className={`w-2 h-2 rounded-full ${style.pip}`} />
                    {t} ({count})
                  </button>
                );
              })}
            </div>
          </div>

          <BirthdaysWidget />

          <div className="rounded-lg border bg-card p-6 overflow-x-auto">
            <OrgChart people={filtered} onSelect={openProfile} />
          </div>
        </div>
      )}

      <ProfileDrawer
        person={selected}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        currentUser={currentUser ?? null}
        allPeople={people}
      />
      <AddPersonDialog open={addOpen} onClose={() => setAddOpen(false)} allPeople={people} />
    </PageLayout>
  );
}

function BirthdaysQuickPip() {
  const { data: birthdays = [] } = useQuery<Birthday[]>({ queryKey: ["/api/hr/birthdays"] });
  const today = birthdays.filter(b => b.daysUntil === 0);
  if (today.length === 0) return null;
  return (
    <Badge className="bg-pink-500 hover:bg-pink-600 text-white" data-testid="badge-birthday-today">
      <Cake className="w-3 h-3 mr-1" /> {today.length === 1 ? `${today[0].name.split(" ")[0]}'s birthday` : `${today.length} birthdays today`}
    </Badge>
  );
}
