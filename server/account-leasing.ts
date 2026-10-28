import type { Querier, AccountProperty } from "./account-resolver";
import type { AccountLeasingAgent, AccountLeasingData, AccountLeasingViewing } from "../shared/account-leasing";
import { canonicalBgpRole } from "../shared/bgp-account-roles";
import { effectiveStatus, isLettingType, isTrackerLiveStatus, TENANT_SIDE_TYPES } from "../shared/letting-rules";
import { calendarDateValue } from "../shared/calendar-date";
import { isPrivateEmailRecord, isPrivateMailboxAddress } from "./private-mail";

const enc = encodeURIComponent;
const propertyHref = (id: string) => `/properties/${enc(id)}`;
const trackerHref = (propertyId: string, unitId?: string) => `/available?propertyId=${enc(propertyId)}${unitId ? `&unitId=${enc(unitId)}` : ""}`;
const viewingHref = (id: string) => `/available?workspace=viewings&viewing=${enc(id)}`;
const iso = (value: unknown) => { const d = new Date(String(value || "")); return Number.isFinite(d.getTime()) ? d.toISOString() : null; };
const STAFF = `u.is_active IS NOT FALSE AND u.client_view_mode IS NOT TRUE
  AND lower(COALESCE(u.role,'')) <> 'client' AND lower(trim(u.email)) LIKE '%@brucegillinghampollard.com'`;
// A saved diary property can identify an unmatched booking. It must never
// override the property of an already linked tracker unit.
const VIEWING_PROPERTY = `CASE WHEN v.unit_id IS NULL THEN NULLIF(v.source_details->>'sourcePropertyId','') ELSE au.property_id END`;

export function privateLeasingViewing(row: any): boolean {
  const source = row.source_details || {};
  return isPrivateEmailRecord(source) || isPrivateEmailRecord({ attendees: row.attendees, bgp_user: row.owner_email })
    || [source.ownerMailbox, row.contact_email, row.agent_email].some(isPrivateMailboxAddress);
}

export function privateWorkspaceAction(row: any): boolean {
  return [row.owner_email,row.assigner_email,row.task_contact_email].some(isPrivateMailboxAddress)
    || privateLeasingViewing({source_details:row.viewing_source_details,attendees:row.viewing_attendees,
      owner_email:row.viewing_owner_email,contact_email:row.viewing_contact_email,agent_email:row.viewing_agent_email});
}

/** Read the existing tracker, diary and tasks by exact portfolio IDs. It
 * never reconciles tasks, confirms bookings or creates an instruction. */
export async function getAccountLeasing(
  companyId: string,
  properties: Pick<AccountProperty, "propertyId" | "name">[],
  entityIds: string[],
  deps: { pool: Querier; now?: Date },
): Promise<AccountLeasingData> {
  const q = deps.pool, now = deps.now || new Date();
  const result: AccountLeasingData = { checkedAt: now.toISOString(), properties: [], agents: [], upcomingViewings: [], recentViewings: [], nextActions: [], issues: [] };
  const propertyIds = [...new Set(properties.map(p => p.propertyId))];
  const names = new Map(properties.map(p => [p.propertyId, p.name]));
  const read = async (sql: string, args: any[], label: string) => {
    try { return (await q.query(sql, args)).rows; }
    catch { result.issues.push(`${label} could not be checked`); return []; }
  };
  const [units, staff, propertyRoles, savedRoles, accountRoles, deals, viewingRows, taskRows] = await Promise.all([
    read(`SELECT au.id,au.property_id,au.unit_name,au.marketing_status,au.deal_id,d.status deal_status
      FROM available_units au LEFT JOIN crm_deals d ON d.id=au.deal_id
      WHERE au.property_id=ANY($1::text[]) ORDER BY au.property_id,au.unit_name,au.id`, [propertyIds], "Tracker units"),
    read(`SELECT u.id,COALESCE(u.name,u.username,u.email) name,u.email FROM users u WHERE ${STAFF}`, [], "BGP people"),
    read(`SELECT property_id,user_id,role FROM crm_property_agents WHERE property_id=ANY($1::text[])`, [propertyIds], "Property teams"),
    read(`SELECT x.id,x.user_id,x.property_id,x.role FROM crm_landlord_team_contexts x
      WHERE x.company_id=ANY($1::text[]) AND (x.property_id IS NULL OR x.property_id=ANY($2::text[]))`, [entityIds,propertyIds], "Saved leasing roles"),
    read(`SELECT c.id company_id,r.user_id,r.role FROM crm_companies c
      CROSS JOIN LATERAL unnest(COALESCE(c.bgp_contact_user_ids,ARRAY[]::text[])) m(user_id)
      JOIN crm_company_bgp_roles r ON r.company_id=c.id AND r.user_id=m.user_id
      WHERE c.id=ANY($1::text[])`, [entityIds], "Saved account teams"),
    read(`SELECT d.id,d.name,d.property_id,d.deal_type,d.bgp_acting_for,d.status,d.internal_agent_ids
      FROM crm_deals d WHERE d.property_id=ANY($1::text[]) AND d.updated_at>= $2::timestamptz - interval '24 months'
      ORDER BY d.updated_at DESC,d.id`, [propertyIds,now.toISOString()], "Leasing deal history"),
    read(`SELECT v.id,v.unit_id,v.company_id,COALESCE(c.name,v.company_name) brand_name,v.owner_user_id,
      COALESCE(u.name,u.username) owner_name,u.email owner_email,v.viewing_date,v.viewing_time,v.status,v.outcome,
      v.details_confirmed_at,v.next_action,v.follow_up_date,v.source_details,v.attendees,v.deleted_at,
      ${VIEWING_PROPERTY} AS property_id,au.unit_name,bc.email contact_email,ac.email agent_email
      FROM unit_viewings v LEFT JOIN available_units au ON au.id=v.unit_id
      LEFT JOIN crm_companies c ON c.id=v.company_id LEFT JOIN users u ON u.id=v.owner_user_id
      LEFT JOIN crm_contacts bc ON bc.id=v.contact_id LEFT JOIN crm_contacts ac ON ac.id=v.agent_contact_id
      WHERE (${VIEWING_PROPERTY})=ANY($1::text[]) AND v.deleted_at IS NULL
      ORDER BY v.viewing_date DESC,v.viewing_time,v.id`, [propertyIds], "Viewing records"),
    read(`SELECT t.id,t.title,t.status,t.priority,t.due_date,t.user_id,t.source_ref,
      COALESCE(u.name,u.username) owner_name,u.email owner_email
      FROM user_tasks t JOIN users u ON u.id=t.user_id
      JOIN unit_viewings v ON t.source_ref='viewing_followup:'||v.id
      LEFT JOIN available_units au ON au.id=v.unit_id
      WHERE (${VIEWING_PROPERTY})=ANY($1::text[]) AND t.status IS DISTINCT FROM 'done' AND t.completed_at IS NULL
        AND v.deleted_at IS NULL AND ${STAFF}
      ORDER BY t.due_date ASC NULLS LAST,t.created_at,t.id`, [propertyIds], "Viewing follow-ups"),
  ]);

  result.properties = properties.map(p => ({ id: p.propertyId, name: p.name,
    href: propertyHref(p.propertyId), trackerHref: trackerHref(p.propertyId),
    viewingsHref: `/available?workspace=viewings&propertyId=${enc(p.propertyId)}`,
    units: units.filter(u => u.property_id === p.propertyId && isTrackerLiveStatus(effectiveStatus(u,{status:u.deal_status}) || "AVA")).map(u => ({
      id: u.id, name: u.unit_name || "Tracker unit", status: effectiveStatus(u,{status:u.deal_status}) || "AVA",
      href: trackerHref(p.propertyId,u.id), dealHref: u.deal_id ? `/deals/${enc(u.deal_id)}` : null,
    })),
  })).sort((a,b) => a.name.localeCompare(b.name));
  const users = new Map(staff.filter(u => !isPrivateMailboxAddress(u.email)).map(u => [u.id,u]));
  const agents = new Map<string,AccountLeasingAgent>();
  const addRole = (id: string, context: AccountLeasingAgent["contexts"][number]) => {
    const user = users.get(id); if (!user) return;
    if (!agents.has(id)) agents.set(id,{userId:id,name:user.name,contexts:[]});
    const contexts = agents.get(id)!.contexts;
    if (!contexts.some(c => c.propertyId===context.propertyId && c.basis===context.basis && c.href===context.href)) contexts.push(context);
  };
  for (const role of propertyRoles) if (canonicalBgpRole(role.role)==="Leasing") addRole(role.user_id,{
    propertyId:role.property_id,propertyName:names.get(role.property_id)||null,role:role.role,
    basis:"property_team",href:propertyHref(role.property_id),label:"Saved property team",
  });
  for (const role of savedRoles) if (canonicalBgpRole(role.role)==="Leasing") addRole(role.user_id,{
    propertyId:role.property_id||null,propertyName:names.get(role.property_id)||null,role:role.role,
    basis:"saved_role",href:role.property_id?propertyHref(role.property_id):`/companies/${enc(companyId)}`,label:"Confirmed account role",
  });
  for (const role of accountRoles) if (canonicalBgpRole(role.role)==="Leasing") addRole(role.user_id,{
    propertyId:null,propertyName:null,role:role.role,basis:"saved_role",
    href:`/companies/${enc(role.company_id)}`,label:"Confirmed account role",
  });
  for (const deal of deals) {
    // A tenant-side deal, contradictory type/side or blank representation
    // must never make somebody the landlord's leasing agent.
    if (!isLettingType(deal.deal_type) || String(deal.bgp_acting_for||"").toLowerCase()!=="landlord"
      || (TENANT_SIDE_TYPES as readonly string[]).includes(deal.deal_type)) continue;
    for (const userId of deal.internal_agent_ids || []) addRole(userId,{
      propertyId:deal.property_id,propertyName:names.get(deal.property_id)||null,role:"Leasing agent",
      basis:"deal_record",href:`/deals/${enc(deal.id)}`,label:`${deal.name||"Recorded letting"}${deal.status?` · ${deal.status}`:""}`,
    });
  }
  result.agents=[...agents.values()].sort((a,b)=>a.name.localeCompare(b.name));

  const viewings = new Map<string,AccountLeasingViewing>();
  for (const v of viewingRows) {
    if (privateLeasingViewing(v) || v.status==="not_leasing" || v.deleted_at) continue;
    const date=calendarDateValue(v.viewing_date); if (!date) continue;
    viewings.set(v.id,{id:v.id,propertyId:v.property_id,propertyName:names.get(v.property_id)||"Property",unitId:v.unit_id||null,
      unitName:v.unit_name||"Unit to confirm",brandId:v.company_id||null,brandName:v.brand_name||null,
      ownerId:v.owner_user_id||null,ownerName:v.owner_name||null,date,time:v.viewing_time||null,status:v.status||"scheduled",
      outcome:v.outcome||null,detailsConfirmed:!!v.unit_id&&!!v.details_confirmed_at,nextAction:v.next_action||null,followUpDate:calendarDateValue(v.follow_up_date),
      href:viewingHref(v.id),propertyHref:propertyHref(v.property_id),trackerHref:trackerHref(v.property_id,v.unit_id||undefined)});
  }
  const today = new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit"}).format(now);
  const from = new Date(`${today}T12:00:00Z`); from.setUTCDate(from.getUTCDate()-90);
  const until = new Date(`${today}T12:00:00Z`); until.setUTCDate(until.getUTCDate()+90);
  const byDate = (a:AccountLeasingViewing,b:AccountLeasingViewing) => `${a.date} ${a.time||""} ${a.id}`.localeCompare(`${b.date} ${b.time||""} ${b.id}`);
  result.upcomingViewings=[...viewings.values()].filter(v=>v.date>=today&&v.date<=until.toISOString().slice(0,10)&&v.status==="scheduled").sort(byDate);
  result.recentViewings=[...viewings.values()].filter(v=>(v.date<today||(v.date===today&&v.status!=="scheduled"))&&v.date>=from.toISOString().slice(0,10)).sort((a,b)=>byDate(b,a));
  const seenTasks=new Set<string>();
  result.nextActions=taskRows.flatMap(t=>{
    const v=viewings.get(String(t.source_ref||"").slice("viewing_followup:".length));
    if(!v||["cancelled","no_show","not_leasing"].includes(v.status)||isPrivateMailboxAddress(t.owner_email)||seenTasks.has(t.id))return [];
    seenTasks.add(t.id);
    return [{taskId:t.id,title:t.title,status:t.status||null,priority:t.priority||null,dueDate:iso(t.due_date),ownerId:t.user_id,
      ownerName:t.owner_name||null,viewingId:v.id,propertyId:v.propertyId,propertyName:v.propertyName,
      href:v.href,propertyHref:v.propertyHref,trackerHref:v.trackerHref}];
  });
  return result;
}
