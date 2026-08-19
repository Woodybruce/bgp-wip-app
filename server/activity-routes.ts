/**
 * Activity Curation Routes
 * ========================
 *
 * Single endpoint that drives the <AIActivityCard> on every surface that
 * shows curated email + meeting activity (deal pages, brand profiles,
 * contact pages, hunter rows, etc.).
 *
 * GET  /api/activity/:subjectType/:subjectId  → cached curation (or null)
 * POST /api/activity/:subjectType/:subjectId/curate  → fresh curation
 *
 * Subjects supported: deal | brand | landlord | contact | property
 *
 * Caching: each curate call costs ~30s and 50k+ tokens, so results are
 * stored in crm_activity_cache keyed by (subject_type, subject_id). The
 * GET handler returns the cached row; POST forces a refresh.
 *
 * Side effect: a successful curation writes the latestActivityDate back
 * to the underlying record's `last_interaction` column so the Deals
 * board / Companies board can show colour-coded "Last Touch" badges
 * without re-running the curator on every render.
 */
import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";
import {
  curateActivity,
  type ActivitySubject,
  type CuratedActivity,
} from "./ai-activity-curator";

type SubjectType = ActivitySubject["type"];
const VALID_TYPES: SubjectType[] = ["deal", "brand", "landlord", "contact", "property"];

// Resolve seed terms for a given subject by reading the underlying CRM
// records. Keeps the prompt-builder pure — all DB lookups happen here.
async function buildSubject(type: SubjectType, id: string): Promise<ActivitySubject | null> {
  switch (type) {
    case "deal": {
      const r = await pool.query(
        `SELECT d.id, d.name, d.tenant_id, d.landlord_id, d.vendor_id, d.purchaser_id,
                d.property_id, d.client_contact_id,
                p.name AS property_name, p.postcode AS property_postcode,
                t.name AS tenant_name, l.name AS landlord_name,
                v.name AS vendor_name, pu.name AS purchaser_name,
                c.name AS contact_name
         FROM crm_deals d
         LEFT JOIN crm_properties p ON p.id = d.property_id
         LEFT JOIN crm_companies t ON t.id = d.tenant_id
         LEFT JOIN crm_companies l ON l.id = d.landlord_id
         LEFT JOIN crm_companies v ON v.id = d.vendor_id
         LEFT JOIN crm_companies pu ON pu.id = d.purchaser_id
         LEFT JOIN crm_contacts c ON c.id = d.client_contact_id
         WHERE d.id = $1`,
        [id]
      );
      const row = r.rows[0];
      if (!row) return null;
      return {
        type: "deal",
        id,
        name: row.name,
        address: row.property_name,
        postcode: row.property_postcode,
        tenantName: row.tenant_name,
        landlordName: row.landlord_name,
        vendorName: row.vendor_name,
        purchaserName: row.purchaser_name,
        contactNames: row.contact_name ? [row.contact_name] : [],
      };
    }
    case "brand":
    case "landlord": {
      const r = await pool.query(
        `SELECT id, name, parent_company_id FROM crm_companies WHERE id = $1`,
        [id]
      );
      const row = r.rows[0];
      if (!row) return null;
      const aliases: string[] = [];
      if (row.parent_company_id) {
        const p = await pool.query(`SELECT name FROM crm_companies WHERE id = $1`, [row.parent_company_id]);
        if (p.rows[0]?.name) aliases.push(p.rows[0].name);
      }
      // For landlords, pull a few of their owned property names as extra seed terms.
      let addresses: string[] | undefined;
      if (type === "landlord") {
        const props = await pool.query(
          `SELECT name FROM crm_properties WHERE landlord_id = $1 LIMIT 8`,
          [id]
        );
        addresses = props.rows.map((p) => p.name).filter(Boolean);
      }
      const contactsRes = await pool.query(
        `SELECT name FROM crm_contacts WHERE company_id = $1 LIMIT 6`,
        [id]
      );
      const contactNames = contactsRes.rows.map((c) => c.name).filter(Boolean);
      return type === "brand"
        ? { type: "brand", id, name: row.name, aliases, contactNames }
        : { type: "landlord", id, name: row.name, aliases, addresses, contactNames };
    }
    case "contact": {
      const r = await pool.query(
        `SELECT c.id, c.name, c.email, co.name AS company_name
         FROM crm_contacts c
         LEFT JOIN crm_companies co ON co.id = c.company_id
         WHERE c.id = $1`,
        [id]
      );
      const row = r.rows[0];
      if (!row) return null;
      return { type: "contact", id, name: row.name, email: row.email, companyName: row.company_name };
    }
    case "property": {
      const r = await pool.query(
        `SELECT id, name, postcode FROM crm_properties WHERE id = $1`,
        [id]
      );
      const row = r.rows[0];
      if (!row) return null;
      return { type: "property", id, address: row.name, postcode: row.postcode };
    }
  }
  return null;
}

// In-flight curation jobs, keyed by `${type}:${id}`. Used to dedupe
// concurrent curate requests for the same subject and to expose an
// "is anything cooking?" flag to the GET endpoint so the client can
// poll instead of holding a 200s HTTP connection open.
const pendingCurations = new Map<string, Promise<void>>();
const curationKey = (t: SubjectType, id: string) => `${t}:${id}`;

// Failed curations, keyed like pendingCurations. The GET auto-kick would
// otherwise relaunch a doomed job on every 4s client poll (and report
// inFlight: true each time, so the "Analysing…" spinner never resolved
// when curation fails fast, e.g. AI service not configured). A recent
// failure suppresses the auto-kick; an explicit POST /curate clears it.
const recentCurationFailures = new Map<string, number>();
const CURATION_FAILURE_COOLDOWN_MS = 10 * 60 * 1000;

// Read cached curation. Returns null if no cache row exists.
async function readCache(type: SubjectType, id: string): Promise<(CuratedActivity & { fromCache: true }) | null> {
  const r = await pool.query(
    `SELECT markdown, email_refs, meeting_refs, latest_at, generated_at
     FROM crm_activity_cache WHERE subject_type = $1 AND subject_id = $2`,
    [type, id]
  );
  if (!r.rows[0]) return null;
  const row = r.rows[0];
  return {
    fromCache: true,
    markdown: row.markdown || "",
    emailHits: Array.isArray(row.email_refs) ? row.email_refs : [],
    meetingHits: Array.isArray(row.meeting_refs) ? row.meeting_refs : [],
    generatedAt: row.generated_at instanceof Date ? row.generated_at.toISOString() : String(row.generated_at),
    latestActivityDate: row.latest_at instanceof Date ? row.latest_at.toISOString() : (row.latest_at || null),
  };
}

async function writeCache(type: SubjectType, id: string, curated: CuratedActivity): Promise<void> {
  await pool.query(
    `INSERT INTO crm_activity_cache (subject_type, subject_id, markdown, email_refs, meeting_refs, latest_at, generated_at)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)
     ON CONFLICT (subject_type, subject_id) DO UPDATE SET
       markdown = EXCLUDED.markdown,
       email_refs = EXCLUDED.email_refs,
       meeting_refs = EXCLUDED.meeting_refs,
       latest_at = EXCLUDED.latest_at,
       generated_at = EXCLUDED.generated_at`,
    [
      type,
      id,
      curated.markdown,
      JSON.stringify(curated.emailHits),
      JSON.stringify(curated.meetingHits),
      curated.latestActivityDate,
      curated.generatedAt,
    ]
  );
}

// Denormalise the latest activity date back onto the underlying CRM
// record so list views ("Last Touch" column on the Deals board) don't
// have to re-curate per row.
async function writeLastInteraction(type: SubjectType, id: string, latest: string | null): Promise<void> {
  if (!latest) return;
  try {
    if (type === "deal") {
      await pool.query(`UPDATE crm_deals SET last_interaction = $1 WHERE id = $2`, [latest, id]);
    } else if (type === "brand" || type === "landlord") {
      await pool.query(`UPDATE crm_companies SET last_interaction = $1 WHERE id = $2`, [latest, id]);
    } else if (type === "contact") {
      await pool.query(`UPDATE crm_contacts SET last_interaction = $1 WHERE id = $2`, [latest, id]);
    }
  } catch (err: any) {
    console.warn(`[activity-routes] writeLastInteraction(${type}/${id}) failed: ${err?.message}`);
  }
}

// Fingerprint of a degraded "no mailbox access" curation (produced when a
// run somehow lacks the email/calendar tools). Never cached, never
// displayed — curations now always run staff-grade via the internal token
// in chatbgp-internal, so this is a tripwire, not an expected state.
// Targets INABILITY statements only — a legit client-facing summary may
// reasonably advise "speak to your BGP team", so advice phrases would
// false-positive (the Gail's slip-through said "is a BGP-staff action" and
// "I'm not able to run that search", which the old regex missed).
const DEGRADED_CURATION_RE = /accessible to me|not able to run (that|this) search|don'?t have access to (BGP|the team|internal)|a BGP.?(team|staff) action|only BGP staff|client session/i;

// Resolve whether the request comes from a real external client login
// (Landsec etc.) and which company it's scoped to. Client viewers get a
// SEPARATE, client-scoped curation (cache key `<id>@client:<companyId>`)
// covering only their own schemes' intersection with the subject — never
// the staff read, which carries other landlords' matters, fees and
// internal strategy. Staff (including "Viewing as <client>" previews)
// keep the staff cache.
async function resolveClientViewer(req: Request): Promise<{ companyId: string; companyName: string } | null> {
  try {
    const { isClientRequestUser, resolveCompanyScope } = await import("./company-scope");
    if (!(await isClientRequestUser(req))) return null;
    const companyId = await resolveCompanyScope(req);
    if (!companyId) return null;
    const r = await pool.query(`SELECT name FROM crm_companies WHERE id = $1`, [companyId]);
    return { companyId, companyName: r.rows[0]?.name || "the client" };
  } catch {
    return null;
  }
}

// May this client company open a raw email / meeting by id? Only if the
// ref appears in one of ITS OWN client-scoped curation caches — the raw
// Graph endpoints are otherwise staff-wide and would let a client session
// open any BGP mailbox item it had an id for.
export async function clientRefAllowed(companyId: string, kind: "email" | "meeting", refId: string): Promise<boolean> {
  if (!refId) return false;
  try {
    const r = await pool.query(
      `SELECT email_refs, meeting_refs FROM crm_activity_cache WHERE subject_id LIKE '%@client:' || $1`,
      [companyId]
    );
    for (const row of r.rows) {
      const refs = kind === "email" ? row.email_refs : row.meeting_refs;
      if (Array.isArray(refs) && refs.some((x: any) => String(kind === "email" ? x?.msgId : x?.eventId) === refId)) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

export function registerActivityRoutes(app: Express) {
  // Cached read — fast, used by <AIActivityCard> on first render and
  // by the poll loop after the client kicks off a background curation.
  app.get("/api/activity/:subjectType/:subjectId", requireAuth, async (req: Request, res: Response) => {
    const { subjectType, subjectId } = req.params as { subjectType: SubjectType; subjectId: string };
    if (!VALID_TYPES.includes(subjectType)) return res.status(400).json({ error: "invalid subject type" });
    try {
      // Client logins read (and generate) a client-scoped variant — see
      // resolveClientViewer. Woody, 2026-08-19: "show Landsec all our
      // Landsec related exposure to Gail's / tenants".
      const clientViewer = await resolveClientViewer(req);
      const cacheId = clientViewer ? `${subjectId}@client:${clientViewer.companyId}` : subjectId;
      const cache = await readCache(subjectType, cacheId);
      const key = curationKey(subjectType, cacheId);
      let inFlight = pendingCurations.has(key);

      // Stale-while-revalidate (Woody, 2026-08-03 — the Landsec board was
      // serving an "analysed 17 May" read in August). A cache older than
      // 7 days kicks a background re-curation on read, server-initiated —
      // client viewers can't POST /curate themselves, but they shouldn't be
      // stuck with a months-old relationship read either. The pending-job
      // map dedupes concurrent kicks; failures keep the old cache.
      //
      // A MISSING cache kicks too (Woody, 2026-08-04 — the Bills panel sat
      // on "analysis taking longer than expected" forever): a never-analysed
      // subject opened by a client-scoped viewer had no path to a first
      // read, since only staff can POST /curate.
      // 24h freshness (was 7 days) — the Re-analyse button is gone (Woody,
      // 2026-08-19: "automate when the brand is opened"), so opening a
      // subject IS the refresh. The pending-job map + failure cooldown keep
      // a busy day from re-running the same subject more than once.
      const STALE_MS = 24 * 60 * 60 * 1000;
      const cacheAge = cache?.generatedAt ? Date.now() - new Date(cache.generatedAt).getTime() : null;
      // A cached curation carrying the client-voice fingerprint is one of
      // the poisoned runs — treat as missing so the next staff open heals it.
      const degradedCache = !!cache && DEGRADED_CURATION_RE.test(cache.markdown || "");
      const needsCuration = !cache || degradedCache || (cacheAge !== null && cacheAge > STALE_MS);
      const failedAt = recentCurationFailures.get(key);
      const coolingDown = failedAt !== undefined && Date.now() - failedAt < CURATION_FAILURE_COOLDOWN_MS;
      // Any viewer's open may trigger generation — the curation itself now
      // always runs staff-grade via the internal token (chatbgp-internal),
      // so a client-triggered run produces the same full mailbox sweep.
      if (needsCuration && !inFlight && !coolingDown) {
        const subject = await buildSubject(subjectType, subjectId);
        if (subject) {
          const job = (async () => {
            try {
              // 25-min budget: matches the POST /curate path — a big landlord
              // sweep (Landsec) outran the earlier 12-min budget and the
              // finished result was binned (2026-08-04).
              const curated = await curateActivity(subject, req, {
                timeoutMs: 25 * 60 * 1000,
                clientScope: clientViewer ? { companyName: clientViewer.companyName } : undefined,
              });
              if (curated && DEGRADED_CURATION_RE.test(curated.markdown || "")) {
                console.warn(`[activity auto-refresh ${subjectType}/${cacheId}] refused to cache degraded curation`);
                recentCurationFailures.set(key, Date.now());
              } else if (curated) {
                await writeCache(subjectType, cacheId, curated);
                // Client-scoped reads are a subset — don't stamp the
                // record-level last_interaction off them.
                if (!clientViewer) await writeLastInteraction(subjectType, subjectId, curated.latestActivityDate);
                recentCurationFailures.delete(key);
              } else {
                recentCurationFailures.set(key, Date.now());
              }
            } catch (err: any) {
              console.error(`[activity auto-refresh ${subjectType}/${cacheId}]`, err?.message || err);
              recentCurationFailures.set(key, Date.now());
            } finally {
              pendingCurations.delete(key);
            }
          })();
          pendingCurations.set(key, job);
          inFlight = true;
        }
      }

      // Never DISPLAY a degraded client-voice curation either — serve the
      // empty state so the card shows "analysing" instead of telling staff
      // their own mailboxes are inaccessible while the re-run cooks.
      res.json({
        ...(cache && !degradedCache
          ? cache
          : { fromCache: false, markdown: "", emailHits: [], meetingHits: [], generatedAt: null, latestActivityDate: null }),
        inFlight,
      });
    } catch (err: any) {
      console.error(`[activity GET ${subjectType}/${subjectId}]`, err?.message);
      res.status(500).json({ error: err?.message || "failed" });
    }
  });

  // Fetch a single calendar event by mailbox + eventId. Backs the
  // <MeetingViewerDialog> opened by [M#] chips in <AIActivityCard>.
  // Mirrors /api/pathway/email/:mailbox/:msgId for emails — Graph IDs
  // are mailbox-scoped so we need both.
  app.get("/api/activity/meeting/:mailboxEmail/:eventId", requireAuth, async (req: Request, res: Response) => {
    try {
      const { graphRequest } = await import("./shared-mailbox");
      const mailboxEmail = String(req.params.mailboxEmail);
      const eventId = String(req.params.eventId);

      // Client logins may only open meetings cited in their OWN
      // client-scoped curations — this is otherwise a staff-wide window
      // into any BGP calendar.
      const clientViewer = await resolveClientViewer(req);
      if (clientViewer && !(await clientRefAllowed(clientViewer.companyId, "meeting", eventId))) {
        return res.status(403).json({ error: "This item isn't available on client accounts" });
      }

      const ev: any = await graphRequest(
        `/users/${encodeURIComponent(mailboxEmail)}/events/${encodeURIComponent(eventId)}?$select=id,subject,bodyPreview,body,start,end,location,organizer,attendees,isOnlineMeeting,onlineMeeting,webLink,isAllDay,isCancelled,showAs,categories`,
        { headers: { "X-AnchorMailbox": mailboxEmail } }
      );

      res.json({
        id: ev.id,
        subject: ev.subject || "(No subject)",
        bodyContentType: ev.body?.contentType || "text",
        bodyHtml: ev.body?.contentType === "html" ? (ev.body?.content || "") : "",
        bodyText: ev.body?.contentType === "text" ? (ev.body?.content || "") : (ev.bodyPreview || ""),
        start: ev.start?.dateTime || null,
        end: ev.end?.dateTime || null,
        timeZone: ev.start?.timeZone || null,
        isAllDay: !!ev.isAllDay,
        isCancelled: !!ev.isCancelled,
        showAs: ev.showAs || null,
        location: ev.location?.displayName || null,
        organizer: {
          name: ev.organizer?.emailAddress?.name,
          email: ev.organizer?.emailAddress?.address,
        },
        attendees: (ev.attendees || []).map((a: any) => ({
          name: a.emailAddress?.name,
          email: a.emailAddress?.address,
          response: a.status?.response || null,
          type: a.type || null,
        })),
        isOnlineMeeting: !!ev.isOnlineMeeting,
        joinUrl: ev.onlineMeeting?.joinUrl || null,
        webLink: ev.webLink || null,
        categories: ev.categories || [],
      });
    } catch (err: any) {
      console.error(`[activity meeting fetch ${req.params.mailboxEmail}/${req.params.eventId}]`, err?.message);
      res.status(500).json({ error: err?.message || "Failed to fetch meeting" });
    }
  });

  // Fresh curation — expensive (~30–200s, full ChatBGP turn). We kick the
  // work off in the background and return 202 immediately so the client
  // doesn't hold a long HTTP connection open (which Railway's edge proxy
  // was timing out). The client polls GET to detect when generated_at
  // updates. Concurrent kicks for the same subject share one job.
  app.post("/api/activity/:subjectType/:subjectId/curate", requireAuth, async (req: Request, res: Response) => {
    const { subjectType, subjectId } = req.params as { subjectType: SubjectType; subjectId: string };
    if (!VALID_TYPES.includes(subjectType)) return res.status(400).json({ error: "invalid subject type" });
    // Client logins refresh their client-scoped variant, never the staff read.
    const clientViewer = await resolveClientViewer(req);
    const cacheId = clientViewer ? `${subjectId}@client:${clientViewer.companyId}` : subjectId;
    const key = curationKey(subjectType, cacheId);
    if (pendingCurations.has(key)) {
      return res.status(202).json({ accepted: true, inFlight: true, alreadyRunning: true });
    }
    // An explicit user retry overrides the auto-kick cooldown.
    recentCurationFailures.delete(key);

    const subject = await buildSubject(subjectType, subjectId);
    if (!subject) return res.status(404).json({ error: "subject not found" });

    const job = (async () => {
      try {
        // 25-min budget: the mailbox+calendar sweep outran 5 minutes, and a
        // big landlord (Landsec: 12 mailboxes + calendars) outran 12 too —
        // both times the finished sweep was binned and the stale cache
        // survived (2026-08-04).
        const curated = await curateActivity(subject, req, {
          timeoutMs: 25 * 60 * 1000,
          clientScope: clientViewer ? { companyName: clientViewer.companyName } : undefined,
        });
        if (!curated) {
          console.warn(`[activity curate ${subjectType}/${cacheId}] ChatBGP returned nothing`);
          recentCurationFailures.set(key, Date.now());
          return;
        }
        if (DEGRADED_CURATION_RE.test(curated.markdown || "")) {
          console.warn(`[activity curate ${subjectType}/${cacheId}] refused to cache degraded curation`);
          recentCurationFailures.set(key, Date.now());
          return;
        }
        await writeCache(subjectType, cacheId, curated);
        if (!clientViewer) await writeLastInteraction(subjectType, subjectId, curated.latestActivityDate);
        recentCurationFailures.delete(key);
      } catch (err: any) {
        console.error(`[activity curate ${subjectType}/${cacheId}]`, err?.message || err);
        recentCurationFailures.set(key, Date.now());
      } finally {
        pendingCurations.delete(key);
      }
    })();
    pendingCurations.set(key, job);

    res.status(202).json({ accepted: true, inFlight: true });
  });
}
