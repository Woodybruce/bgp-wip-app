import type { Express, Request, Response } from "express";
import type { Querier } from "./account-resolver";
import { requireAuth } from "./auth";
import { canReadLandlordMeetings, getLandlordMeetingDigest } from "./landlord-meetings";
import { LANDLORD_CATALOGUE_PREDICATE, landlordDomains } from "./landlord-meeting-matching";
import { LANDLORD_TEAM_ROLES, type LandlordRelationshipTeamData, type LandlordTeamMember, type LandlordTeamSource } from "../shared/landlord-relationship-team";

const STAFF = `lower(COALESCE(u.email,'')) LIKE '%@brucegillinghampollard.com' AND lower(COALESCE(u.role,'')) <> 'client'`;
const PROPERTIES = `SELECT p.id,p.name FROM crm_properties p WHERE p.landlord_id=$1 OR p.freeholder_id=$1 OR p.long_leaseholder_id=$1 OR p.asset_manager_id=$1
  OR EXISTS(SELECT 1 FROM crm_company_properties cp WHERE cp.property_id=p.id AND cp.company_id=$1)
  OR EXISTS(SELECT 1 FROM crm_deals d WHERE d.property_id=p.id AND (d.landlord_id=$1 OR d.vendor_id=$1 OR d.purchaser_id=$1
    OR EXISTS(SELECT 1 FROM crm_company_deals cd WHERE cd.deal_id=d.id AND cd.company_id=$1)))`;
export function landlordTeamEmailPath(domains: string[]): string | null {
  if (!domains.length) return null;
  const escaped = domains.map(domain => domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return '$[*] ? (@ like_regex ' + JSON.stringify('@([^.@]+[.])*(' + escaped.join('|') + ')$') + ' flag "i")';
}

export const LANDLORD_TEAM_EMAIL_SQL = `WITH linked_contacts AS MATERIALIZED (
  SELECT ct.id FROM crm_contacts ct WHERE ct.company_id=$1
    OR ($2::jsonpath IS NOT NULL AND jsonb_path_exists(jsonb_build_array(ct.email),$2::jsonpath))
), linked AS MATERIALIZED (
  SELECT i.id,i.microsoft_id,i.interaction_date,i.bgp_user,i.participants
  FROM crm_interactions i WHERE i.company_id=$1 AND i.type='email' AND i.interaction_date<=now()
  UNION ALL
  SELECT i.id,i.microsoft_id,i.interaction_date,i.bgp_user,i.participants
  FROM linked_contacts contact JOIN crm_interactions i ON i.contact_id=contact.id
  WHERE i.type='email' AND i.interaction_date<=now()
), participants AS (
  SELECT COALESCE(NULLIF(i.microsoft_id,''),i.id::text) message_key,i.interaction_date,lower(trim(i.bgp_user)) email FROM linked i
  UNION ALL
  SELECT COALESCE(NULLIF(i.microsoft_id,''),i.id::text),i.interaction_date,lower(trim(participant.email))
  FROM linked i CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(i.participants)='array' THEN i.participants ELSE '[]'::jsonb END) AS participant(email)
)
SELECT u.id user_id,COUNT(DISTINCT participant.message_key)::int email_count,MAX(participant.interaction_date) last_touch
FROM participants participant JOIN users u ON lower(trim(u.email))=participant.email
WHERE ${STAFF} GROUP BY u.id`;

const iso = (value: unknown) => { const date = new Date(String(value || '')); return Number.isFinite(date.getTime()) ? date.toISOString() : null; };

export function assembleLandlordRelationshipTeam(input: {
  companyId: string; staff: any[]; assignedIds: string[]; roles: any[]; properties: any[]; emails: any[];
  meetings: any[]; conversations?: any[]; deals: any[]; advisory: any[]; propertyAgents: any[]; manual: any[]; issues?: string[]; diaryStatus?: string; now?: Date;
}): LandlordRelationshipTeamData {
  const members = new Map<string, LandlordTeamMember>();
  const byId = new Map(input.staff.map(user => [user.id, user]));
  const byEmail = new Map(input.staff.filter(user => user.email).map(user => [String(user.email).trim().toLowerCase(), user]));
  const assigned = new Set(input.assignedIds || []);
  const propertyNames = new Map(input.properties.map(property => [property.id, property.name]));
  const get = (id: string) => {
    const user = byId.get(id); if (!user) return null;
    if (!members.has(id)) members.set(id, { id, name: user.name || user.email, title: user.title || null,
      profilePicUrl: user.profile_pic_url || null, active: user.is_active !== false, assigned: assigned.has(id),
      assignedRole: input.roles.find(role => role.user_id === id)?.role || null,
      emailCount: 0, meetingCount: 0, dealCount: 0, conversationCount: 0, lastInteractionAt: null, contexts: [] });
    return members.get(id)!;
  };
  const touch = (member: LandlordTeamMember, date: unknown) => { const value = iso(date); if (value && (!member.lastInteractionAt || value > member.lastInteractionAt)) member.lastInteractionAt = value; };
  const agents = (row: any) => {
    const ids = new Set<string>((row.internal_agent_ids || []).filter((id: string) => byId.has(id)));
    // Names are a legacy fallback only. Ambiguous names never identify a person.
    if (!(row.internal_agent_ids || []).length) for (const name of row.internal_agent || []) {
      const matches = input.staff.filter(user => String(user.name).trim().toLowerCase() === String(name).trim().toLowerCase());
      if (matches.length === 1) ids.add(matches[0].id);
    }
    return [...ids];
  };
  const addContext = (member: LandlordTeamMember, role: string, propertyId: string | null, source: LandlordTeamSource, notes: string) => {
    const key = `suggested:${member.id}:${role}:${propertyId || ''}`;
    let context = member.contexts.find(item => item.id === key);
    if (!context) { context = { id: key, role, propertyId, propertyName: propertyNames.get(propertyId) || null, origin: 'suggested', notes, sources: [] }; member.contexts.push(context); }
    if (!context.sources.some(item => item.kind === source.kind && item.id === source.id)) context.sources.push(source);
  };
  for (const id of assigned) get(id);
  for (const role of input.roles) if (role.role) get(role.user_id);
  for (const row of input.emails) { const member = get(row.user_id); if (member) { member.emailCount = Number(row.email_count) || 0; touch(member, row.last_touch); } }
  for (const row of input.conversations || []) { const member = get(row.user_id); if (member) { member.conversationCount = Number(row.message_count) || 0; touch(member, row.last_touch); } }
  const meetingKeys = new Map<string, Set<string>>();
  for (const meeting of input.meetings) for (const person of meeting.participants || []) {
    const user = byEmail.get(String(person.email || '').toLowerCase()); if (!user) continue;
    const member = get(user.id)!; const keys = meetingKeys.get(user.id) || new Set<string>(); keys.add(meeting.id); meetingKeys.set(user.id, keys);
    member.meetingCount = keys.size;
    const start = iso(meeting.start);
    if (start && start <= (input.now || new Date()).toISOString()) touch(member, start);
  }
  const dealKeys = new Map<string, Set<string>>();
  for (const deal of input.deals) for (const id of agents(deal)) {
    const member = get(id)!; const keys = dealKeys.get(id) || new Set<string>(); keys.add(deal.id); dealKeys.set(id, keys); member.dealCount = keys.size;
    const type = String(deal.deal_type || '').trim().toLowerCase();
    const explicitTenantType = ['lease acquisition', 'tenant acquisition', 'lease disposal', 'sub-letting', 'tenant rep'].includes(type);
    const side = String(deal.bgp_acting_for || '').trim().toLowerCase();
    const conflictingSide = side === 'landlord' && explicitTenantType;
    const tenant = side === 'tenant' || (!side && explicitTenantType);
    const advisory = /lease advisory|rent review|lease renewal|dilapidation|regear/.test(type) || (deal.team || []).some((name: string) => name.toLowerCase() === 'lease advisory');
    const leasing = /letting|lease disposal|lease acquisition|sub-letting|tenant acquisition/.test(type) || ['temp lease','licence'].includes(type);
    const role = conflictingSide ? null : advisory ? 'Lease advisory' : tenant ? 'Tenant representative' : leasing && side === 'landlord' ? 'Leasing agent' : /investment|acquisition|disposal|sale/.test(type) ? 'Investment' : null;
    if (conflictingSide && !input.issues?.includes(`Deal ${deal.deal_ref || deal.name || deal.id} has conflicting representation fields; no role was suggested`)) (input.issues ||= []).push(`Deal ${deal.deal_ref || deal.name || deal.id} has conflicting representation fields; no role was suggested`);
    if (deal.property_id && deal.property_name) propertyNames.set(deal.property_id, deal.property_name);
    if (role) addContext(member, role, deal.property_id || null, { kind: 'deal', id: deal.id, label: `${deal.name || 'Deal'}${deal.deal_ref ? ` #${deal.deal_ref}` : ''}${deal.status ? ` · ${deal.status}` : ''}`, url: `/deals/${encodeURIComponent(deal.id)}` },
      tenant ? `Tenant-side work${deal.tenant_name ? ` for ${deal.tenant_name}` : ''}; does not establish a landlord instruction.` : 'Role suggested by the saved deal; the deal stage does not establish a current landlord mandate.');
  }
  for (const matter of input.advisory) for (const id of new Set([matter.lead_user_id, ...(matter.team_user_ids || [])])) {
    const member = get(id); if (!member) continue;
    addContext(member, 'Lease advisory', matter.property_id, { kind: 'lease_advisory', id: matter.id, label: `${String(matter.matter_type || 'Lease advisory').replaceAll('_',' ')}${matter.status ? ` · ${matter.status}` : ''}`, url: `/pla/matters/${encodeURIComponent(matter.id)}` },
      matter.acting_for === 'tenant' ? 'Recorded lease advisory work for the tenant; not a landlord mandate.' : matter.acting_for === 'landlord' ? 'Recorded landlord-side lease advisory matter; check its current status.' : 'Lease advisory matter; the represented party is not recorded.');
  }
  for (const row of input.propertyAgents) {
    const member = get(row.user_id); if (!member) continue;
    const role = /leas|letting/i.test(row.role || '') ? 'Leasing agent' : /invest/i.test(row.role || '') ? 'Investment' : null;
    if (role) addContext(member, role, row.property_id, { kind: 'property', id: row.property_id, label: 'Property team record', url: `/properties/${encodeURIComponent(row.property_id)}` }, 'Suggested from the saved property-team role; not a new instruction.');
  }
  for (const row of input.manual) {
    const member = get(row.user_id); if (!member) continue;
    member.contexts = member.contexts.filter(context => !(context.role === row.role && context.propertyId === (row.property_id || null)));
    member.contexts.push({ id: row.id, role: row.role, propertyId: row.property_id || null, propertyName: propertyNames.get(row.property_id) || row.property_name || null,
      origin: 'manual', notes: row.notes || '', sources: [] });
  }
  return { companyId: input.companyId, members: [...members.values()].sort((a,b) => a.name.localeCompare(b.name)),
    properties: input.properties.map(p => ({ id: p.id, name: p.name })), issues: input.issues || [], diaryStatus: input.diaryStatus || 'not_synced', checkedAt: (input.now || new Date()).toISOString() };
}

export async function getLandlordRelationshipTeam(companyId: string, deps: { q?: Querier; viewerId?: string; meetingDigest?: typeof getLandlordMeetingDigest } = {}): Promise<LandlordRelationshipTeamData | null> {
  const q = deps.q || (await import('./db')).pool;
  const company = (await q.query(`SELECT c.id,c.name,c.company_type,c.domain,c.domain_url,c.bgp_contact_user_ids FROM crm_companies c WHERE c.id=$1 AND ${LANDLORD_CATALOGUE_PREDICATE}`, [companyId])).rows[0];
  if (!company) return null;
  const issues: string[] = [];
  const read = async (sql: string, args: any[], label: string) => { try { return (await q.query(sql,args)).rows; } catch { issues.push(`${label} could not be checked`); return []; } };
  const [staff, roles, properties, emails, manual, digest, conversations] = await Promise.all([
    read(`SELECT u.id,COALESCE(u.name,u.username,u.email) name,lower(trim(u.email)) email,u.role title,u.profile_pic_url,u.is_active FROM users u WHERE ${STAFF}`, [], 'BGP people'),
    read(`SELECT user_id,role FROM crm_company_bgp_roles WHERE company_id=$1`, [companyId], 'Saved account roles'),
    read(PROPERTIES,[companyId],'Linked properties'),
    read(LANDLORD_TEAM_EMAIL_SQL, [companyId,landlordTeamEmailPath(landlordDomains({...company,contacts:[]}))], 'Email interactions'),
    read(`SELECT x.*,p.name property_name FROM crm_landlord_team_contexts x LEFT JOIN crm_properties p ON p.id=x.property_id WHERE x.company_id=$1`,[companyId],'Saved role contexts'),
    (deps.meetingDigest || getLandlordMeetingDigest)({companyId},q).catch(()=>({meetings:[],coverage:{status:'not_synced',issues:['Diaries could not be checked']}})),
    deps.viewerId ? read(`SELECT m.user_id,COUNT(DISTINCT m.id)::int message_count,MAX(m.created_at) last_touch
      FROM chat_messages m JOIN chat_threads t ON t.id=m.thread_id
      WHERE t.linked_type='company' AND t.linked_id=$1 AND m.role='user' AND m.user_id IS NOT NULL AND m.created_at<=now()
        AND (t.created_by=$2 OR EXISTS(SELECT 1 FROM chat_thread_members tm WHERE tm.thread_id=t.id AND tm.user_id=$2))
      GROUP BY m.user_id`,[companyId,deps.viewerId],'Landlord conversations') : Promise.resolve([]),
  ]);
  const propertyIds=properties.map(p=>p.id);
  const [deals, advisory, propertyAgents] = await Promise.all([
    read(`SELECT d.id,d.name,d.deal_ref,d.status,d.property_id,d.deal_type,d.bgp_acting_for,d.team,d.internal_agent,d.internal_agent_ids,tc.name tenant_name,p.name property_name
      FROM crm_deals d LEFT JOIN crm_companies tc ON tc.id=d.tenant_id LEFT JOIN crm_properties p ON p.id=d.property_id WHERE d.landlord_id=$1 OR d.vendor_id=$1 OR d.purchaser_id=$1 OR d.property_id=ANY($2::text[]) OR EXISTS(SELECT 1 FROM crm_company_deals cd WHERE cd.deal_id=d.id AND cd.company_id=$1)`,[companyId,propertyIds],'Deal history'),
    read(`SELECT id,property_id,matter_type,acting_for,status,lead_user_id,team_user_ids FROM pla_matters WHERE client_company_id=$1 OR property_id=ANY($2::text[])`,[companyId,propertyIds],'Lease advisory history'),
    read(`SELECT property_id,user_id,role FROM crm_property_agents WHERE property_id=ANY($1::text[])`,[propertyIds],'Property teams'),
  ]);
  if (digest.coverage.status!=='current') issues.push('Diary coverage is incomplete; some participants may be missing');
  return assembleLandlordRelationshipTeam({companyId,staff,assignedIds:company.bgp_contact_user_ids||[],roles,properties,emails,manual,conversations,meetings:digest.meetings,deals,advisory,propertyAgents,issues,diaryStatus:digest.coverage.status});
}

export async function saveLandlordTeamContext(input: { companyId:string; userId:string; role:string; propertyId?:string|null; notes?:string; actorId:string }, q?:Querier) {
  q ||= (await import('./db')).pool;
  if (!LANDLORD_TEAM_ROLES.includes(input.role as any)) throw new Error('Choose a role from the list');
  if (!(await q.query(`SELECT c.id FROM crm_companies c WHERE c.id=$1 AND ${LANDLORD_CATALOGUE_PREDICATE}`,[input.companyId])).rows.length) throw new Error('Landlord not found');
  if (!(await q.query(`SELECT u.id FROM users u WHERE u.id=$1 AND ${STAFF}`,[input.userId])).rows.length) throw new Error('BGP person not found');
  if (input.propertyId && !(await q.query(PROPERTIES,[input.companyId])).rows.some(p=>p.id===input.propertyId)) throw new Error('Choose a property linked to this landlord');
  const result=await q.query(`INSERT INTO crm_landlord_team_contexts(company_id,user_id,role,property_id,notes,created_by)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(company_id,user_id,role,(COALESCE(property_id,''))) DO UPDATE SET notes=EXCLUDED.notes,updated_at=now() RETURNING id`,
    [input.companyId,input.userId,input.role,input.propertyId||null,String(input.notes||'').trim().slice(0,500),input.actorId]);
  return {ok:true,id:result.rows[0].id};
}

export function registerLandlordTeamRoutes(app: Express) {
  const allowed = async(req:Request,res:Response)=>{if(await canReadLandlordMeetings(req))return true;res.status(403).json({error:'Available to BGP staff only'});return false;};
  app.get('/api/crm/landlords/:companyId/team',requireAuth,async(req,res)=>{
    try { if(!await allowed(req,res))return;const team=await getLandlordRelationshipTeam(String(req.params.companyId),{viewerId:String(req.session?.userId||(req as any).tokenUserId)}); if(!team)return res.status(404).json({error:'Landlord not found'});res.json(team); }
    catch { res.status(503).json({error:'The relationship team could not be loaded'}); }
  });
  app.post('/api/crm/landlords/:companyId/team/contexts',requireAuth,async(req,res)=>{
    try { if(!await allowed(req,res))return;res.json(await saveLandlordTeamContext({companyId:String(req.params.companyId),userId:String(req.body?.userId||''),role:String(req.body?.role||''),propertyId:req.body?.propertyId?String(req.body.propertyId):null,notes:String(req.body?.notes||''),actorId:String(req.session?.userId||(req as any).tokenUserId)})); }
    catch(error:any) { const safe=['Choose a role from the list','Landlord not found','BGP person not found','Choose a property linked to this landlord'].includes(error?.message);res.status(safe?400:503).json({error:safe?error.message:'The role could not be saved'}); }
  });
  app.delete('/api/crm/landlords/:companyId/team/contexts/:contextId',requireAuth,async(req,res)=>{
    try {if(!await allowed(req,res))return;const q=(await import('./db')).pool;
      const result=await q.query(`DELETE FROM crm_landlord_team_contexts x USING crm_companies c WHERE x.id=$1 AND x.company_id=$2 AND c.id=x.company_id AND ${LANDLORD_CATALOGUE_PREDICATE} RETURNING x.id`,[String(req.params.contextId),String(req.params.companyId)]);
      if(!result.rows.length)return res.status(404).json({error:'Saved landlord role not found'});res.json({ok:true});
    }catch{res.status(503).json({error:'The saved role could not be removed'});}
  });
}
