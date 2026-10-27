import type { Express, Request, Response } from 'express';
import type { LandlordMeeting, LandlordMeetingDigest, LandlordMeetingPerson } from '../shared/landlord-meetings';
import { requireAuth } from './auth';
import { pool } from './db';
import { getAppToken } from './shared-mailbox';
import { isClientRequestUser, resolveCompanyScope } from './company-scope';
import { parseGraphDateTime } from './viewing-matching';
import { LANDLORD_CATALOGUE_PREDICATE, matchLandlordMeeting, londonWeek, type LandlordCatalogueEntry } from './landlord-meeting-matching';

type Queryable = { query: (text: string, values?: any[]) => Promise<{ rows: any[] }> };
const PREFIX = 'landlord_diary_v1:';
const MAX_AGE_MS = 2 * 60 * 60 * 1000;
const STAFF_DOMAIN = '@brucegillinghampollard.com';
let refreshing = false;

interface DiaryEvent {
  id: string;
  uid: string;
  subject: string;
  start: string;
  end: string;
  location: string;
  participants: LandlordMeetingPerson[];
  webLink: string | null;
  cancelled: boolean;
  modifiedAt: string | null;
}
interface DiarySnapshot {
  mailbox: string;
  checkedAt: string | null;
  attemptedAt: string;
  scanStartedAt?: string;
  start: string;
  end: string;
  events: DiaryEvent[];
  revocations?: Array<{ id: string; uid: string; at: string; modifiedAt: string | null; private: boolean; excluded?: boolean }>;
  issue: string | null;
}

export async function loadLandlordCatalogue(q: Queryable = pool): Promise<LandlordCatalogueEntry[]> {
  const { rows } = await q.query(`SELECT c.id,c.name,c.company_type,c.domain,c.domain_url,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'email',p.email))
      FROM crm_contacts p WHERE p.company_id=c.id), '[]'::jsonb) AS contacts
    FROM crm_companies c WHERE ${LANDLORD_CATALOGUE_PREDICATE}`);
  return rows;
}

async function staffMailboxes(q: Queryable = pool): Promise<Array<{ email: string; name: string }>> {
  const { rows } = await q.query(`SELECT lower(trim(email)) AS email,name FROM users
    WHERE lower(trim(email)) LIKE '%@brucegillinghampollard.com'
      AND COALESCE(role,'') <> 'Client' AND is_active IS DISTINCT FROM false`);
  return [...new Map(rows.map(row => [row.email, row])).values()];
}

function person(raw: any): LandlordMeetingPerson | null {
  const email = String(raw?.emailAddress?.address || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return null;
  return { email, name: String(raw?.emailAddress?.name || email).trim() };
}

function safeInvitationLink(value: unknown): string | null {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && /^(outlook\.office\.com|outlook\.office365\.com|outlook\.live\.com)$/.test(url.hostname) ? url.href : null;
  } catch { return null; }
}

export function isLandlordDiaryAbsence(subject: unknown): boolean {
  const text = String(subject || '').replace(/[_–—]/g, ' ');
  return /\b(?:(?:annual|sick|parental|maternity|paternity|compassionate|unpaid)\s+leave|out[\s-]+of[\s-]+(?:the\s+)?office|ooo|oof|paid\s+time\s+off)\b/i.test(text);
}

export function normaliseLandlordDiaryEvent(raw: any): DiaryEvent | null {
  // The diary sync is business context, never a way to reveal private events.
  if (!raw.sensitivity) throw new Error('Microsoft did not return the meeting privacy setting');
  if (raw.sensitivity !== 'normal') return null;
  if (raw.type === 'seriesMaster') return null;
  if (!raw.start?.dateTime || !raw.end?.dateTime || !raw.id) throw new Error('Microsoft returned an incomplete meeting');
  const start = parseGraphDateTime(raw.start).toISOString();
  const end = parseGraphDateTime(raw.end).toISOString();
  if (end < start) throw new Error('Calendar returned an invalid meeting end time');
  const people = [person(raw.organizer), ...(raw.attendees || []).map(person)].filter(Boolean) as LandlordMeetingPerson[];
  return {
    id: String(raw.id), uid: String(raw.iCalUId || ''), subject: String(raw.subject || '(No subject)'), start, end,
    location: String(raw.location?.displayName || ''), participants: [...new Map(people.map(p => [p.email, p])).values()],
    webLink: safeInvitationLink(raw.webLink), cancelled: raw.isCancelled === true,
    modifiedAt: raw.lastModifiedDateTime && Number.isFinite(Date.parse(raw.lastModifiedDateTime)) ? new Date(raw.lastModifiedDateTime).toISOString() : null,
  };
}

// Existing settings-backed snapshots retain invitation fields that the legacy
// contact-only interaction table cannot hold. No dummy contacts are created.
export async function captureLandlordDiary(
  rawEvents: any[], mailbox: string, window: { start: string; end: string },
  options: { q?: Queryable; catalogue?: LandlordCatalogueEntry[]; now?: Date; scanStartedAt?: string } = {},
): Promise<void> {
  const q = options.q || pool;
  if (!(await staffMailboxes(q)).some(member => member.email === mailbox.toLowerCase())) return;
  const catalogue = options.catalogue || await loadLandlordCatalogue(q);
  const checkedAt = (options.now || new Date()).toISOString();
  const events = rawEvents.map(normaliseLandlordDiaryEvent).filter((event): event is DiaryEvent => !!event)
    .filter(event => !isLandlordDiaryAbsence(event.subject) && matchLandlordMeeting(event.subject, event.participants, catalogue).length > 0);
  const previous = (await q.query('SELECT value FROM system_settings WHERE key=$1', [PREFIX + mailbox.toLowerCase()])).rows[0]?.value as DiarySnapshot | undefined;
  const eventKey = (event: { id: string; uid: string }) => event.uid || event.id;
  const currentKeys = new Set(events.map(eventKey));
  const revocations = (previous?.revocations || []).filter(revocation => !currentKeys.has(eventKey(revocation)));
  for (const event of previous?.events || []) {
    if (event.start >= window.start && event.start < window.end && !currentKeys.has(eventKey(event))) {
      revocations.push({ id: event.id, uid: event.uid, at: checkedAt, modifiedAt: event.modifiedAt, private: false });
    }
  }
  for (const event of rawEvents) {
    const excluded = isLandlordDiaryAbsence(event.subject);
    if ((event.sensitivity === 'normal' && !excluded) || !event.id) continue;
    // Keep only revocation identifiers, never excluded/private diary details.
    // Older shared copies must not reintroduce them into landlord meetings.
    revocations.push({ id: String(event.id), uid: String(event.iCalUId || ''), at: checkedAt,
      modifiedAt: event.lastModifiedDateTime && Number.isFinite(Date.parse(event.lastModifiedDateTime)) ? new Date(event.lastModifiedDateTime).toISOString() : null,
      private: event.sensitivity !== 'normal', excluded });
  }
  const snapshot: DiarySnapshot = { mailbox: mailbox.toLowerCase(), checkedAt, attemptedAt: checkedAt, scanStartedAt: options.scanStartedAt || checkedAt, ...window, events,
    revocations: [...new Map(revocations.map(revocation => [eventKey(revocation), revocation])).values()], issue: null };
  await q.query(`INSERT INTO system_settings(key,value,updated_at) VALUES($1,$2::jsonb,now())
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()
    WHERE COALESCE(system_settings.value->>'scanStartedAt','') <= EXCLUDED.value->>'scanStartedAt'`, [PREFIX + snapshot.mailbox, JSON.stringify(snapshot)]);
}

export async function recordLandlordDiaryFailure(mailbox: string, issue: string, q: Queryable = pool): Promise<void> {
  const patch = { mailbox: mailbox.toLowerCase(), attemptedAt: new Date().toISOString(), issue };
  await q.query(`INSERT INTO system_settings(key,value,updated_at) VALUES($1,$2::jsonb,now())
    ON CONFLICT(key) DO UPDATE SET value=COALESCE(system_settings.value,'{}'::jsonb)||EXCLUDED.value,updated_at=now()`,
  [PREFIX + patch.mailbox, JSON.stringify(patch)]);
}

export function buildLandlordMeetingDigest(
  snapshots: DiarySnapshot[], catalogue: LandlordCatalogueEntry[], staff: Array<{ email: string; name: string }>,
  options: { companyId?: string; weekOnly?: boolean; now?: Date } = {},
): LandlordMeetingDigest {
  const now = options.now || new Date();
  const week = londonWeek(now);
  const staffNames = new Map(staff.map(member => [member.email.toLowerCase(), member.name]));
  const byMailbox = new Map(snapshots.map(snapshot => [snapshot.mailbox, snapshot]));
  const checked = staff.filter(member => byMailbox.get(member.email)?.checkedAt);
  const issues: string[] = [];
  for (const member of staff) {
    const snapshot = byMailbox.get(member.email);
    if (!snapshot?.checkedAt) { issues.push(`${member.name}: ${snapshot?.issue || 'diary not checked'}`); continue; }
    if (snapshot.issue) issues.push(`${member.name}: ${snapshot.issue}`);
    else if (now.getTime() - Date.parse(snapshot.checkedAt) > MAX_AGE_MS) issues.push(`${member.name}: diary check is over two hours old`);
    if (!snapshot.start || !snapshot.end || snapshot.start > week.start || snapshot.end < week.end) issues.push(`${member.name}: current week is not fully covered`);
  }
  if (!staff.length) issues.push('No active BGP staff diaries are configured');
  const sources = new Map<string, { event: DiaryEvent; snapshot: DiarySnapshot }>();
  for (const snapshot of snapshots) {
    if (!staffNames.has(snapshot.mailbox) || !snapshot.checkedAt) continue;
    for (const event of snapshot.events || []) {
      // iCalUId distinguishes individual recurrence instances and survives
      // reschedules. A mailbox-local id is never treated as a shared uid.
      const key = event.uid || `${snapshot.mailbox}:${event.id}`;
      const prior = sources.get(key);
      const version = event.modifiedAt || snapshot.checkedAt;
      const priorVersion = prior?.event.modifiedAt || prior?.snapshot.checkedAt || '';
      if (!prior || version > priorVersion || (version === priorVersion && event.cancelled)) sources.set(key, { event, snapshot });
    }
  }
  const meetings: LandlordMeeting[] = [];
  const revoked = snapshots.filter(snapshot => staffNames.has(snapshot.mailbox)).flatMap(snapshot =>
    (snapshot.revocations || []).map(revocation => ({ ...revocation, key: revocation.uid || `${snapshot.mailbox}:${revocation.id}` })));
  for (const [key, { event, snapshot }] of sources) {
    if (event.cancelled) continue;
    if (isLandlordDiaryAbsence(event.subject)) continue;
    if (revoked.some(revocation => revocation.key === key && (revocation.private || revocation.excluded
      ? (event.modifiedAt || snapshot.checkedAt!) <= (revocation.modifiedAt || revocation.at)
      : snapshot.checkedAt! <= revocation.at))) continue;
    if (options.weekOnly && (event.start < week.start || event.start >= week.end)) continue;
    const matches = matchLandlordMeeting(event.subject, event.participants, catalogue);
    for (const { company, reasons } of matches) {
      if (options.companyId && company.id !== options.companyId) continue;
      const participants = event.participants.map(p => ({ ...p, name: staffNames.get(p.email) || p.name }));
      meetings.push({ id: `${company.id}:${key}`, companyId: company.id, companyName: company.name,
        subject: event.subject, start: event.start, end: event.end, location: event.location, participants,
        bgpParticipants: participants.filter(p => staffNames.has(p.email)), source: 'calendar', sourceId: event.id,
        mailbox: snapshot.mailbox, webLink: event.webLink, matchReasons: reasons, checkedAt: snapshot.checkedAt!,
      });
    }
  }
  meetings.sort((a,b) => a.start.localeCompare(b.start) || a.companyName.localeCompare(b.companyName));
  const dates = checked.map(member => byMailbox.get(member.email)!.checkedAt!).sort();
  return { meetings, nextMeeting: meetings.find(meeting => meeting.end >= now.toISOString()) || null, week,
    coverage: { status: checked.length === 0 ? 'not_synced' : issues.length ? 'partial' : 'current',
      checkedAt: dates[0] || null, mailboxesChecked: checked.length, mailboxesExpected: staff.length, issues, refreshing },
  };
}

export async function getLandlordMeetingDigest(
  options: { companyId?: string; weekOnly?: boolean; now?: Date } = {}, q: Queryable = pool,
): Promise<LandlordMeetingDigest> {
  const [catalogue, staff, saved] = await Promise.all([
    loadLandlordCatalogue(q), staffMailboxes(q),
    q.query(`SELECT value FROM system_settings WHERE left(key,$1)=$2`, [PREFIX.length, PREFIX]),
  ]);
  return buildLandlordMeetingDigest(saved.rows.map(row => row.value), catalogue, staff, options);
}

export async function fetchLandlordCalendar(token: string, mailbox: string, window: { start: string; end: string }, fetcher: typeof fetch = fetch): Promise<any[]> {
  const select = 'id,iCalUId,subject,start,end,attendees,organizer,location,isCancelled,sensitivity,webLink,type,lastModifiedDateTime';
  let url: string | null = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/calendarView?startDateTime=${window.start}&endDateTime=${window.end}&$select=${select}&$top=250&$orderby=start/dateTime`;
  const events: any[] = [];
  let pages = 0;
  while (url) {
    if (++pages > 100) throw new Error('Diary exceeded the page limit; the scan is incomplete');
    const parsed = new URL(url);
    if (parsed.origin !== 'https://graph.microsoft.com' || !parsed.pathname.startsWith('/v1.0/')) throw new Error('Invalid calendar continuation link');
    let response: globalThis.Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await fetcher(url, { headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="UTC"' }, signal: AbortSignal.timeout(30000) });
      if (![429,503].includes(response.status) || attempt === 2) break;
      const seconds = Math.min(10, Math.max(1, Number(response.headers.get('retry-after')) || 2));
      await new Promise(resolve => setTimeout(resolve, seconds * 1000));
    }
    response = response!;
    if (!response.ok) throw new Error(response.status === 403 ? 'Microsoft denied access to this diary'
      : response.status === 404 ? 'Microsoft could not find an Outlook calendar for this account' : `Microsoft diary unavailable (HTTP ${response.status})`);
    let data: any;
    try { data = await response.json(); } catch { throw new Error('Microsoft returned an incomplete diary response'); }
    if (!Array.isArray(data.value)) throw new Error('Microsoft returned an invalid diary response');
    events.push(...data.value);
    url = data['@odata.nextLink'] || null;
  }
  return events;
}

async function refreshLandlordDiaries(): Promise<void> {
  const now = new Date();
  const window = { start: new Date(now.getTime() - 30 * 86400000).toISOString(), end: new Date(now.getTime() + 90 * 86400000).toISOString() };
  const [staff, catalogue] = await Promise.all([staffMailboxes(), loadLandlordCatalogue()]);
  let token: string;
  try { token = await getAppToken(); } catch {
    for (const member of staff) await recordLandlordDiaryFailure(member.email, 'Microsoft diary connection is unavailable');
    return;
  }
  // Same app-authorised active staff mailboxes as the established interaction
  // sync; small batches avoid turning a profile refresh into a mailbox flood.
  for (let offset = 0; offset < staff.length; offset += 3) {
    await Promise.all(staff.slice(offset, offset + 3).map(async member => {
      try { await captureLandlordDiary(await fetchLandlordCalendar(token, member.email, window), member.email, window, { catalogue, scanStartedAt: now.toISOString() }); }
      catch (error: any) { await recordLandlordDiaryFailure(member.email, error?.message || 'Diary scan failed'); }
    }));
  }
}

export async function canReadLandlordMeetings(req: Request): Promise<boolean> {
  if (await isClientRequestUser(req) || await resolveCompanyScope(req)) return false;
  const userId = req.session?.userId || req.tokenUserId;
  if (!userId) return false;
  const { rows } = await pool.query('SELECT email,role,is_active FROM users WHERE id=$1', [userId]);
  return !!rows[0]?.email?.toLowerCase().endsWith(STAFF_DOMAIN) && rows[0]?.role !== 'Client' && rows[0]?.is_active !== false;
}

interface LandlordCalendarSearch {
  req: Request;
  companyId: string;
  query?: string;
  mailbox?: string;
  teamMember?: string;
  startDateTime?: string;
  endDateTime?: string;
  daysAhead?: number;
  top?: number;
}
interface LandlordCalendarSearchDependencies {
  q?: Queryable;
  canRead?: typeof canReadLandlordMeetings;
  getToken?: typeof getAppToken;
  fetchCalendar?: typeof fetchLandlordCalendar;
  now?: Date;
}

function searchDate(value: string): string {
  const datePart = value.slice(0, 10);
  const calendarDay = new Date(`${datePart}T00:00:00Z`);
  if (!Number.isFinite(calendarDay.getTime()) || calendarDay.toISOString().slice(0, 10) !== datePart) throw new Error('Use a valid calendar date');
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const offset = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', timeZoneName: 'shortOffset' })
      .formatToParts(calendarDay).find(part => part.type === 'timeZoneName')!.value;
    return new Date(calendarDay.getTime() - (offset === 'GMT+1' ? 3600000 : 0)).toISOString();
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
    || !Number.isFinite(Date.parse(value))) throw new Error('Use an ISO date/time with a timezone, or a London calendar date');
  return new Date(value).toISOString();
}

// Landlord chat searches use live, fully paginated diary evidence. They never
// replace the broader weekly snapshots with a narrow search result.
export async function searchLandlordMeetings(options: LandlordCalendarSearch, deps: LandlordCalendarSearchDependencies = {}) {
  const q = deps.q || pool;
  if (!await (deps.canRead || canReadLandlordMeetings)(options.req)) return { error: 'Landlord diary searches are available to active BGP staff only' };
  const now = deps.now || new Date();
  let window: { start: string; end: string; timeZone: 'Europe/London' };
  try {
    const days = options.daysAhead === undefined ? 30 : Number(options.daysAhead);
    if (!Number.isInteger(days) || days < 1 || days > 120) throw new Error('Choose a diary search period of between 1 and 120 days');
    const start = options.startDateTime ? searchDate(options.startDateTime) : now.toISOString();
    const end = options.endDateTime ? searchDate(options.endDateTime) : new Date(Date.parse(start) + days * 86400000).toISOString();
    const duration = Date.parse(end) - Date.parse(start);
    if (duration <= 0 || duration > 120 * 86400000) throw new Error('Choose an end date after the start date, with no more than 120 days in one diary search');
    window = { start, end, timeZone: 'Europe/London' };
  } catch (error: any) { return { error: error.message }; }
  const [catalogue, staff] = await Promise.all([loadLandlordCatalogue(q), staffMailboxes(q)]);
  const company = catalogue.find(entry => entry.id === options.companyId);
  if (!company) return { error: 'The linked landlord could not be found; the diary search was not run' };
  let selected = staff;
  const mailbox = String(options.mailbox || '').trim().toLowerCase();
  const teamMember = String(options.teamMember || '').trim().toLowerCase();
  if (mailbox && mailbox !== 'all' && teamMember && mailbox !== teamMember) return { error: 'Choose either one mailbox or one team member for the diary search' };
  const requested = teamMember || mailbox;
  if (requested && requested !== 'all') {
    if (requested === 'me') {
      const userId = options.req.session?.userId || options.req.tokenUserId;
      const user = (await q.query('SELECT lower(trim(email)) AS email FROM users WHERE id=$1', [userId])).rows[0];
      selected = staff.filter(member => member.email === user?.email);
    } else {
      const exact = staff.filter(member => member.email === requested || member.name.toLowerCase() === requested || member.email.split('@')[0] === requested);
      // A first/last name is usable only when it identifies exactly one active
      // staff member. Never silently choose the first result from several.
      selected = exact.length ? exact : staff.filter(member => !requested.includes('@') && member.name.toLowerCase().split(/\s+/).includes(requested));
    }
    if (selected.length !== 1) return { error: selected.length ? 'That name matches more than one BGP staff member; use their full name or email' : 'No active BGP staff diary matches that mailbox or name' };
  }
  const scope = `${company.name}; ${requested && requested !== 'all' ? selected[0]?.email : 'all active BGP staff diaries'}`;
  const snapshots: DiarySnapshot[] = [];
  const mailboxes: Array<{ mailbox: string; status: 'checked' | 'unavailable'; checkedAt: string | null; issue: string | null }> = [];
  let token: string | null = null;
  try { token = await (deps.getToken || getAppToken)(); } catch { /* Coverage below records the connection failure for every selected diary. */ }
  for (let offset = 0; offset < selected.length; offset += 3) {
    await Promise.all(selected.slice(offset, offset + 3).map(async member => {
      try {
        if (!token) throw new Error('Microsoft diary connection is unavailable');
        const rawEvents = await (deps.fetchCalendar || fetchLandlordCalendar)(token, member.email, window);
        const events = rawEvents.map(normaliseLandlordDiaryEvent).filter((event): event is DiaryEvent => !!event)
          .filter(event => !isLandlordDiaryAbsence(event.subject) && (event.cancelled || matchLandlordMeeting(event.subject, event.participants, catalogue).some(match => match.company.id === company.id)));
        const checkedAt = (deps.now || new Date()).toISOString();
        const revocations = rawEvents.filter(event => (event.sensitivity !== 'normal' || isLandlordDiaryAbsence(event.subject)) && event.id).map(event => ({
          id: String(event.id), uid: String(event.iCalUId || ''), at: checkedAt, private: event.sensitivity !== 'normal', excluded: isLandlordDiaryAbsence(event.subject),
          modifiedAt: event.lastModifiedDateTime && Number.isFinite(Date.parse(event.lastModifiedDateTime)) ? new Date(event.lastModifiedDateTime).toISOString() : null,
        }));
        snapshots.push({ mailbox: member.email, checkedAt, attemptedAt: checkedAt, ...window, events, revocations, issue: null });
        mailboxes.push({ mailbox: member.email, status: 'checked', checkedAt, issue: null });
      } catch (error: any) {
        // Do not expose arbitrary provider bodies or fall back to a stale cached
        // event: a failed mailbox is explicit incomplete coverage.
        const message = String(error?.message || '');
        const issue = /^(Microsoft (?:diary connection is unavailable|denied access to this diary|could not find an Outlook calendar for this account|diary unavailable \(HTTP \d+\)|returned (?:an? )?(?:incomplete|invalid)|did not return)|Diary exceeded|Calendar returned|Invalid calendar continuation)/.test(message)
          ? message : 'The diary could not be fully checked';
        mailboxes.push({ mailbox: member.email, status: 'unavailable', checkedAt: null, issue });
      }
    }));
  }
  const digest = buildLandlordMeetingDigest(snapshots, catalogue, staff, { companyId: company.id, now });
  const excludedUids = new Set(snapshots.flatMap(snapshot => (snapshot.revocations || []).map(revocation => revocation.uid).filter(Boolean)));
  const query = String(options.query || '').trim().slice(0, 200).toLowerCase();
  const terms = query.split(/\s+/).filter(Boolean);
  const matches = digest.meetings.filter(event => !excludedUids.has(event.id.slice(company.id.length + 1)) && event.start < window.end && event.end >= window.start).filter(event => {
    const text = [event.companyName, event.subject, event.location, ...event.participants.flatMap(person => [person.name, person.email])].join(' ').toLowerCase();
    return terms.every(term => text.includes(term));
  });
  const top = Number.isFinite(Number(options.top)) ? Math.min(100, Math.max(1, Math.trunc(Number(options.top)))) : 30;
  const checked = mailboxes.filter(mailbox => mailbox.status === 'checked');
  const issues = mailboxes.filter(mailbox => mailbox.issue).map(mailbox => `${mailbox.mailbox}: ${mailbox.issue}`);
  if (!selected.length) issues.push('No active BGP staff diaries are configured');
  return { events: matches.slice(0, top), total: matches.length, truncated: matches.length > top, query, scope, window,
    coverage: { status: checked.length === 0 ? 'not_synced' : issues.length ? 'partial' : 'current',
      checkedAt: checked.map(mailbox => mailbox.checkedAt!).sort()[0] || null,
      mailboxesChecked: checked.length, mailboxesExpected: selected.length, issues,
      mailboxes: mailboxes.sort((a, b) => a.mailbox.localeCompare(b.mailbox)) } };
}

async function staffOnly(req: Request, res: Response): Promise<boolean> {
  if (await canReadLandlordMeetings(req)) return true;
  res.status(403).json({ error: 'Landlord diary summaries are available to BGP staff only' }); return false;
}

export function registerLandlordMeetingRoutes(app: Express): void {
  app.get('/api/crm/landlords/meetings/week', requireAuth, async (req,res) => {
    try { if (await staffOnly(req,res)) res.json(await getLandlordMeetingDigest({ weekOnly: true })); }
    catch { res.status(503).json({ error: 'Landlord diary summary is unavailable. No meetings have been removed.' }); }
  });
  app.get('/api/crm/landlords/:companyId/meetings', requireAuth, async (req,res) => {
    try {
      if (!await staffOnly(req,res)) return;
      const companyId = String(req.params.companyId);
      if (!(await loadLandlordCatalogue()).some(company => company.id === companyId)) return res.status(404).json({ error: 'Landlord not found' });
      res.json(await getLandlordMeetingDigest({ companyId }));
    } catch { res.status(503).json({ error: 'Landlord diary summary is unavailable. No meetings have been removed.' }); }
  });
  app.post('/api/crm/landlords/meetings/refresh', requireAuth, async (req,res) => {
    try {
      if (!await staffOnly(req,res)) return;
      if (!refreshing) {
        refreshing = true;
        void refreshLandlordDiaries().catch(error => console.warn('[landlord-diary] refresh failed:', error?.message)).finally(() => { refreshing = false; });
      }
      res.status(202).json({ running: true });
    } catch { res.status(503).json({ error: 'Could not start the landlord diary refresh' }); }
  });
}
