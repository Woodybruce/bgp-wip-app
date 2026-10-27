import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Users, Plus, Check, X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest, getAuthHeaders } from "@/lib/queryClient";
import { LANDLORD_TEAM_ROLES, type LandlordRelationshipTeamData, type LandlordTeamContext, type LandlordTeamMember } from "@shared/landlord-relationship-team";

export function LandlordRelationshipTeam({ companyId, canEdit = true }: { companyId: string; canEdit?: boolean }) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const queryKey = ["/api/crm/landlords", companyId, "team"];
  const query = useQuery<LandlordRelationshipTeamData>({ queryKey, staleTime: 60_000, retry: false,
    queryFn: async ({signal}) => {
      const response = await fetch(`/api/crm/landlords/${encodeURIComponent(companyId)}/team`, { credentials: "include", headers: getAuthHeaders(), signal });
      if (!response.ok) throw new Error("The relationship team could not be loaded");
      return response.json();
    },
  });
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey });
    queryClient.invalidateQueries({ queryKey: ["/api/brand", companyId, "ai-take"] });
  };
  const members = query.data?.members || [];
  return <section className="rounded-lg border border-border bg-card p-4 space-y-3" data-testid="landlord-relationship-team">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-semibold text-sm flex items-center gap-2"><Users className="h-4 w-4 text-primary" />BGP team{query.data && <span className="font-normal text-muted-foreground">· {members.length} people</span>}</h3>
      {members.length > 6 && <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)}>{expanded ? "Show fewer" : `View all ${members.length} people`}</Button>}
    </div>
    <p className="text-xs text-muted-foreground">People with recorded involvement.</p>
    {query.isLoading ? <p className="text-sm text-muted-foreground">Loading the team…</p>
      : query.isError ? <p className="text-sm text-muted-foreground" role="status">The team could not be loaded. <button className="underline" onClick={() => query.refetch()}>Try again</button></p>
      : !members.length ? <p className="text-sm text-muted-foreground">No BGP participation is recorded in the checked sources.</p>
      : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(expanded ? members : members.slice(0,6)).map(member => <TeamMember key={member.id} companyId={companyId} member={member} properties={query.data?.properties || []} canEdit={canEdit} onSaved={invalidate} />)}
      </div>}
    {!!query.data?.issues.length && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Some records need checking ({query.data.issues.length})</summary><ul className="list-disc pl-4 mt-2 space-y-1">{query.data.issues.map((issue,i) => <li key={i}>{issue}</li>)}</ul></details>}
  </section>;
}

function TeamMember({ companyId, member, properties, canEdit, onSaved }: { companyId: string; member: LandlordTeamMember; properties: LandlordRelationshipTeamData["properties"]; canEdit: boolean; onSaved: () => void }) {
  const [editing,setEditing] = useState(false);
  const [role,setRole] = useState<string>("Relationship lead");
  const [propertyId,setPropertyId] = useState("");
  const [notes,setNotes] = useState("");
  const save = useMutation({ mutationFn: async (context: {role:string;propertyId:string|null;notes:string}) =>
    (await apiRequest("POST",`/api/crm/landlords/${encodeURIComponent(companyId)}/team/contexts`, {userId:member.id,...context})).json(),
    onSuccess: () => {setEditing(false);setNotes("");onSaved();},
  });
  const remove = useMutation({ mutationFn: async(id:string) =>
    (await apiRequest("DELETE",`/api/crm/landlords/${encodeURIComponent(companyId)}/team/contexts/${encodeURIComponent(id)}`)).json(), onSuccess:onSaved,
  });
  const countLabel = (count:number,noun:string) => count ? `${count} ${noun}${count === 1 ? "" : "s"}` : null;
  const sources = [countLabel(member.emailCount,"email"),countLabel(member.meetingCount,"invitation"),countLabel(member.dealCount,"deal"),countLabel(member.conversationCount,"chat message")].filter(Boolean);
  const last = member.lastInteractionAt ? new Date(member.lastInteractionAt).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric",timeZone:"Europe/London"}) : null;
  const editContext = (context:LandlordTeamContext) => {setRole(context.role);setPropertyId(context.propertyId || "");setNotes(context.notes);setEditing(true);};
  return <article className="rounded-lg border border-border/70 p-3 min-w-0 space-y-2" data-testid="landlord-team-member">
    <div className="flex gap-2.5 items-start">
      <Avatar className="h-9 w-9 shrink-0"><AvatarImage src={member.profilePicUrl || undefined} alt="" /><AvatarFallback className="text-xs">{member.name.split(/\s+/).slice(0,2).map(x=>x[0]).join("")}</AvatarFallback></Avatar>
      <div className="min-w-0 flex-1"><h4 className="text-sm font-semibold">{member.name}</h4>{member.title && <p className="text-xs text-muted-foreground">{member.title}</p>}{!member.active && <p className="text-xs text-muted-foreground">Former team member · recorded history</p>}</div>
      {canEdit && <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={()=>{setRole("Relationship lead");setPropertyId("");setNotes("");setEditing(!editing);}} aria-label={`Add role for ${member.name}`}><Plus className="w-3.5 h-3.5" /></Button>}
    </div>
    <p className="text-xs text-muted-foreground">{sources.length ? sources.join(" · ") : "Saved account assignment"}{last && <span className="block mt-0.5">Latest recorded activity {last}</span>}</p>
    {member.assignedRole && <p className="text-xs font-medium">{member.assignedRole} <span className="font-normal text-muted-foreground">· saved account role</span></p>}
    {!!member.contexts.length && <div className="space-y-2">
      {member.contexts.map(context => <div key={context.id} className="rounded-md bg-muted/40 px-2.5 py-2 space-y-1" data-testid="landlord-team-context">
        <p className="text-xs font-semibold">{context.role} <span className="font-normal">· {context.propertyName || (context.propertyId ? "Property name unavailable" : "Account-wide")}</span></p>
        <p className="text-[11px] text-muted-foreground">{context.origin === "manual" ? "Confirmed role" : "Suggested from records"}</p>
        {context.origin === "manual" && context.notes && <p className="text-xs leading-relaxed text-muted-foreground">{context.notes}</p>}
        {!!context.sources.length && <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Evidence ({context.sources.length})</summary>{context.notes && <p className="text-muted-foreground mt-1 leading-relaxed">{context.notes}</p>}<ul className="mt-1 space-y-1">{context.sources.map(source => <li key={`${source.kind}:${source.id}`}><a className="underline underline-offset-2" href={source.url}>{source.label}</a></li>)}</ul></details>}
        {canEdit && <div className="flex items-center gap-2 pt-1">
          {context.origin === "suggested" ? <><button className="text-xs text-primary inline-flex items-center gap-1 hover:underline disabled:opacity-50" disabled={save.isPending} onClick={()=>save.mutate({role:context.role,propertyId:context.propertyId,notes:context.notes})}><Check className="h-3 w-3" />Confirm role</button><button className="text-xs text-muted-foreground hover:underline" onClick={()=>editContext(context)}>Adjust</button></>
            : <button className="text-xs text-muted-foreground hover:underline disabled:opacity-50" disabled={remove.isPending} onClick={()=>remove.mutate(context.id)}>Remove saved role</button>}
        </div>}
      </div>)}
    </div>}
    {!member.contexts.length && !member.assignedRole && <p className="text-xs text-muted-foreground">Role not recorded</p>}
    {editing && <form className="space-y-2 border-t pt-2" onSubmit={event=>{event.preventDefault();save.mutate({role,propertyId:propertyId||null,notes});}}>
      <label className="block text-xs">Role<select value={role} onChange={e=>setRole(e.target.value)} className="mt-1 w-full rounded border border-input bg-background p-2 text-xs">{LANDLORD_TEAM_ROLES.map(item=><option key={item}>{item}</option>)}</select></label>
      <label className="block text-xs">Property<select value={propertyId} onChange={e=>setPropertyId(e.target.value)} className="mt-1 w-full rounded border border-input bg-background p-2 text-xs"><option value="">Account-wide</option>{properties.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <Input value={notes} onChange={e=>setNotes(e.target.value)} maxLength={500} placeholder="Context, represented party or scope" aria-label="Role context" className="h-8 text-xs" />
      <div className="flex gap-2"><Button size="sm" type="submit" disabled={save.isPending}>{save.isPending?"Saving…":"Save role"}</Button><Button size="sm" variant="ghost" type="button" onClick={()=>setEditing(false)}><X className="h-3 w-3" />Cancel</Button></div>
    </form>}
    {(save.isError||remove.isError) && <p role="status" className="text-xs text-destructive">The role could not be saved. Check the selected property and try again.</p>}
  </article>;
}
