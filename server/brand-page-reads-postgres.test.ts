/**
 * brand-page-reads-postgres.test.ts — the brand page's slow reads, rewritten
 * to use their indexes (13 November 2026), return what they returned before.
 *
 * Each statement below is run beside the statement it replaced, on the same
 * rows, and the answers must match: the brand news list, the expansion
 * score's two counts of the correspondence log, the Key contacts mailbox
 * read, the contacts check's senders and the brand's email rows. A second
 * check asks the planner, with whole-table scans switched off, whether each
 * new statement can be answered from an index (the old ones could not).
 *
 * Runs on a real PostgreSQL in TEMPORARY tables on one connection: nothing
 * is written to the database it is pointed at. Skipped unless
 * BRAND_DEALS_TEST_DATABASE_URL names one (the same variable as the brand
 * deal list test):
 *   BRAND_DEALS_TEST_DATABASE_URL=postgresql://... node --import tsx --test server/brand-page-reads-postgres.test.ts
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import pg from "pg";
import { INTERACTIONS_90D_SQL, DOMAIN_THREADS_90D_SQL, KNOWN_CONTACTS_MAILBOX_SQL } from "./brand-profile-suggestions";

const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require("../qa/regression/source-harness.cjs");
const declaration = (file: string, name: string) => find(file, (node: any) =>
  (ts.isVariableStatement(node) && node.declarationList.declarations.some((d: any) => d.name.getText() === name))
  || (ts.isFunctionDeclaration(node) && node.name?.text === name)).replace(/^export /gm, "");
const constant = (file: string, name: string): string => evaluate(`${declaration(file, name)}\nexports.value=${name};`).value;

const DOMAIN_SENDERS_SQL = constant("server/brand-contacts-check.ts", "DOMAIN_SENDERS_SQL");
const BRAND_EMAIL_ROWS_SQL = constant("server/brand-email-threads.ts", "BRAND_EMAIL_ROWS_SQL");
const { brandNewsQuery } = evaluate(["likeEscape", "brandNewsPatterns", "brandNewsQuery"].map(name => declaration("server/brand-profile.ts", name)).join("\n")
  + "\nexports.brandNewsQuery=brandNewsQuery;");

// The statements as they were before 13 November 2026.
const OLD_INTERACTIONS_90D = `SELECT count(*)::int AS n FROM crm_interactions i
   LEFT JOIN crm_contacts c ON c.id = i.contact_id
  WHERE (i.company_id = $1 OR c.company_id = $1)
    AND i.interaction_date >= now() - interval '90 days' AND i.interaction_date <= now()`;
const OLD_DOMAIN_THREADS_90D = `SELECT count(DISTINCT i.id)::int AS n FROM crm_interactions i
   CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(i.participants) = 'array' THEN i.participants ELSE '[]'::jsonb END) p
  WHERE p ILIKE $1 AND i.interaction_date >= now() - interval '90 days' AND i.interaction_date <= now()`;
const OLD_MAILBOX = `SELECT id, participants, to_char(interaction_date, 'YYYY-MM-DD') AS interaction_date,
         bgp_user, subject, direction
    FROM crm_interactions
   WHERE interaction_date >= $1
     AND participants IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM jsonb_array_elements_text(participants) AS p(addr)
       WHERE lower(addr) LIKE $2
     )
   ORDER BY interaction_date DESC
   LIMIT 1000`;
const OLD_DOMAIN_SENDERS = `
  SELECT LOWER(p) AS email, COUNT(*)::int AS threads, MAX(interaction_date) AS last_touch
    FROM crm_interactions
    CROSS JOIN LATERAL jsonb_array_elements_text(participants) AS p
   WHERE participants IS NOT NULL AND jsonb_typeof(participants) = 'array'
     AND interaction_date <= NOW() AND p ILIKE $1
   GROUP BY LOWER(p)
   ORDER BY threads DESC, last_touch DESC
   LIMIT 40`;
const OLD_BRAND_EMAIL_ROWS = `
  SELECT DISTINCT ON (COALESCE(i.microsoft_id, i.subject || '|' || i.interaction_date::text))
         i.subject, i.direction, i.bgp_user, i.preview, i.participants, i.interaction_date
    FROM crm_interactions i
   WHERE i.interaction_date <= NOW()
     AND (i.type IS NULL OR i.type ILIKE '%email%')
     AND (i.company_id = $2 OR EXISTS (
           SELECT 1 FROM jsonb_array_elements_text(
             CASE WHEN jsonb_typeof(i.participants) = 'array' THEN i.participants ELSE '[]'::jsonb END) p
            WHERE p ILIKE $1))
   ORDER BY COALESCE(i.microsoft_id, i.subject || '|' || i.interaction_date::text), i.interaction_date DESC
   LIMIT 1500`;
const oldNews = (sql: string) => sql.replace(
  "n.source_id = ANY(ARRAY(SELECT ns.id FROM news_sources ns WHERE ns.category = 'brand:' || $1 AND ns.type = 'google_news'))",
  "n.source_id IN (SELECT ns.id FROM news_sources ns WHERE ns.category = 'brand:' || $1 AND ns.type = 'google_news')");

const COMPANIES = ["co-alpha", "co-beta", "co-none", "co-missing"];
const DOMAINS = ["alpha.example", "beta-foods.co.uk", "al_ha.example", "nobody.example"];

describe("the brand page's rewritten reads on PostgreSQL", { skip: !process.env.BRAND_DEALS_TEST_DATABASE_URL }, () => {
  let db: pg.Client;
  let trigram = false;
  const rows = async (text: string, values: any[]) => (await db.query(text, values)).rows;
  const sorted = (list: any[]) => list.map(row => JSON.stringify(row)).sort();
  const plan = async (text: string, values: any[]) => {
    // With whole-table scans and plain index walks both switched off, a
    // statement that can be answered from an index condition shows it.
    await db.query("SET enable_seqscan = off; SET enable_indexscan = off");
    try { return (await db.query(`EXPLAIN ${text}`, values)).rows.map(row => row["QUERY PLAN"]).join("\n"); }
    finally { await db.query("RESET enable_seqscan; RESET enable_indexscan"); }
  };

  before(async () => {
    db = new pg.Client({ connectionString: process.env.BRAND_DEALS_TEST_DATABASE_URL, ssl: false });
    await db.connect();
    trigram = (await db.query(`SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'`)).rows.length > 0;
    // Temporary tables hide the real ones for this connection only.
    await db.query(`
      CREATE TEMP TABLE crm_contacts(id varchar PRIMARY KEY, company_id varchar, email text, name text);
      CREATE TEMP TABLE crm_interactions(id varchar PRIMARY KEY, contact_id varchar NOT NULL, company_id varchar, type text NOT NULL,
        direction text, subject text, preview text, participants jsonb, microsoft_id text, interaction_date timestamp NOT NULL, bgp_user text);
      CREATE TEMP TABLE news_sources(id varchar PRIMARY KEY, name text, type text NOT NULL, category text);
      CREATE TEMP TABLE news_articles(id varchar PRIMARY KEY, source_id varchar, source_name text, title text NOT NULL, summary text, ai_summary text,
        url text NOT NULL, image_url text, published_at timestamp, fetched_at timestamp DEFAULT now(), category text);
      CREATE INDEX ON crm_interactions (company_id);
      CREATE INDEX ON crm_interactions (contact_id);
      CREATE INDEX ON news_articles (source_id, fetched_at);
      INSERT INTO crm_contacts VALUES
        ('ct-a1','co-alpha','jo@alpha.example','Jo'), ('ct-a2','co-alpha',NULL,'No Email'),
        ('ct-b1','co-beta','pat@beta-foods.co.uk','Pat'), ('ct-x','co-other','x@other.com','Other');
      INSERT INTO news_sources VALUES
        ('feed-alpha','Alpha news','google_news','brand:co-alpha'), ('feed-alpha-2','Alpha news 2','google_news','brand:co-alpha'),
        ('rss-alpha','Alpha RSS','rss','brand:co-alpha'), ('feed-beta','Beta news','google_news','brand:co-beta'), ('trade','Trade press','rss','general');
      INSERT INTO news_articles(id, source_id, source_name, title, summary, url, published_at)
      SELECT 'n' || n,
             (ARRAY['feed-alpha','feed-alpha-2','rss-alpha','feed-beta','trade',NULL])[1 + n % 6],
             'Source ' || (n % 4),
             CASE n % 7 WHEN 0 THEN 'Alpha''s Kitchen opens in Leeds ' || n WHEN 1 THEN 'ALPHAS KITCHEN signs at Bluewater ' || n
                        WHEN 2 THEN 'Beta Foods expands ' || n ELSE 'Retail round-up number ' || n END,
             CASE n % 5 WHEN 0 THEN 'The operator Alphas Kitchen said ' || n WHEN 1 THEN NULL ELSE 'Nothing to see ' || n END,
             CASE WHEN n % 9 = 0 THEN 'https://alphakitchen.example/news/' || (n % 18)
                  WHEN n % 10 = 0 THEN 'https://trade.example/shared-story' ELSE 'https://trade.example/story/' || n END,
             CASE WHEN n % 23 = 0 THEN NULL ELSE now() - n * interval '7 hours' END
        FROM generate_series(1, 400) n;`);
    if (trigram) await db.query(`
      CREATE INDEX ON crm_interactions USING gin ((participants::text) gin_trgm_ops);
      CREATE INDEX ON news_articles USING gin (title gin_trgm_ops);
      CREATE INDEX ON news_articles USING gin (summary gin_trgm_ops);
      CREATE INDEX ON news_articles USING gin (url gin_trgm_ops);`);
  });
  after(async () => { await db?.end(); });

  // Emails 1..600: against a company, a contact, both or neither; inside and
  // outside 90 days and 24 months, some dated in the future; addresses at
  // the domain in mixed case, addresses that only contain the domain's text,
  // and (when messy) the legacy shapes that are not a list of addresses.
  const loadEmails = (messy: boolean) => db.query(`
    TRUNCATE crm_interactions;
    INSERT INTO crm_interactions(id, contact_id, company_id, type, direction, subject, preview, participants, microsoft_id, interaction_date, bgp_user)
    SELECT 'i' || n,
           (ARRAY['ct-a1','ct-b1','ct-x','ct-gone','ct-a2'])[1 + n % 5],
           CASE n % 7 WHEN 0 THEN 'co-alpha' WHEN 1 THEN 'co-beta' END,
           (ARRAY['email','Email received','meeting'])[1 + n % 3],
           (ARRAY['inbound','outbound'])[1 + n % 2], 'Subject ' || (n % 50), 'Preview ' || n,
           CASE n % 11
             WHEN 0 THEN NULL
             WHEN 1 THEN ${messy ? `'"solo@alpha.example"'` : `'["solo@alpha.example"]'`}::jsonb
             WHEN 2 THEN ${messy ? `'{"to":"x@alpha.example"}'` : `'[]'`}::jsonb
             WHEN 3 THEN '[]'::jsonb
             WHEN 4 THEN '["Jo@ALPHA.example","woody@brucegillinghampollard.com"]'::jsonb
             WHEN 5 THEN '["jo@alpha.example.evil.com","sam@notalpha.example"]'::jsonb
             WHEN 6 THEN '["pat@beta-foods.co.uk","x@alpha.example"]'::jsonb
             WHEN 7 THEN '["a@other.com"]'::jsonb
             WHEN 8 THEN '["o\\"brien@alpha.example","Pat@Beta-Foods.co.uk "]'::jsonb
             WHEN 9 THEN ${messy ? `'[1, null, "k@beta-foods.co.uk"]'` : `'["k@beta-foods.co.uk"]'`}::jsonb
             ELSE '["chef@alpha.example","jo@alpha.example"]'::jsonb
           END,
           CASE WHEN n % 4 = 0 THEN NULL ELSE 'ms-' || (n % 150) END,
           CASE WHEN n % 13 = 0 THEN now() + n * interval '1 hour' ELSE now() - n * interval '31 hours' END,
           (ARRAY['Lucy','Rupert',NULL])[1 + n % 3]
      FROM generate_series(1, 600) n;`);

  it("the expansion score counts the same emails against a company and its contacts", async () => {
    await loadEmails(true);
    let counted = 0;
    for (const company of COMPANIES) {
      const [was] = await rows(OLD_INTERACTIONS_90D, [company]);
      const [now] = await rows(INTERACTIONS_90D_SQL, [company]);
      assert.deepEqual(now, was, company);
      counted += now.n;
    }
    assert.ok(counted > 0, "the sample must hold emails in the window");
  });

  it("the expansion score counts the same email threads with a domain", async () => {
    await loadEmails(true);
    let counted = 0;
    for (const domain of DOMAINS) {
      const [was] = await rows(OLD_DOMAIN_THREADS_90D, [`%@${domain}`]);
      const [now] = await rows(DOMAIN_THREADS_90D_SQL, [`%@${domain}`]);
      assert.deepEqual(now, was, domain);
      counted += now.n;
    }
    assert.ok(counted > 0);
  });

  it("the Key contacts mailbox read returns the same emails", async () => {
    // This read has never guarded against a value that is not a list, so it
    // is compared on lists only.
    await loadEmails(false);
    const since = new Date(); since.setMonth(since.getMonth() - 24);
    let read = 0;
    for (const domain of DOMAINS) {
      const was = await rows(OLD_MAILBOX, [since, `%@${domain}`]);
      const now = await rows(KNOWN_CONTACTS_MAILBOX_SQL, [since, `%@${domain}`, `%@${domain}%`]);
      assert.deepEqual(now, was, domain);
      read += now.length;
    }
    assert.ok(read > 0);
  });

  it("the contacts check reads the same senders at a domain", async () => {
    await loadEmails(true);
    let read = 0;
    for (const domain of DOMAINS) {
      const was = await rows(OLD_DOMAIN_SENDERS, [`%@${domain}`]);
      const now = await rows(DOMAIN_SENDERS_SQL, [`%@${domain}`]);
      assert.deepEqual(sorted(now), sorted(was), domain);
      read += now.length;
    }
    assert.ok(read > 0);
  });

  it("the brand's email history returns the same rows", async () => {
    await loadEmails(true);
    let read = 0;
    for (const [index, domain] of DOMAINS.entries()) {
      const was = await rows(OLD_BRAND_EMAIL_ROWS, [`%@${domain}`, COMPANIES[index]]);
      const now = await rows(BRAND_EMAIL_ROWS_SQL, [`%@${domain}`, COMPANIES[index]]);
      assert.deepEqual(now, was, domain);
      read += now.length;
    }
    assert.ok(read > 0);
  });

  it("the brand news list returns the same articles", async () => {
    const brands = [
      ["co-alpha", { name: "Alpha's Kitchen", domain: "https://www.alphakitchen.example/" }],
      ["co-beta", { name: "Beta Foods" }],
      ["co-none", { name: "Zzyzx Trading" }],
      ["co-alpha", { name: "Alpha's Kitchen", ai_generated_fields: { brand_identity: { status: "verified", aliases: ["Retail round-up"] } } }],
    ] as const;
    let read = 0;
    for (const [id, company] of brands) {
      const query = brandNewsQuery(id, company);
      assert.notEqual(oldNews(query.sql), query.sql, "the old form of the statement must differ");
      const was = await rows(oldNews(query.sql), query.params);
      const now = await rows(query.sql, query.params);
      assert.deepEqual(now.map(row => row.id), was.map(row => row.id), company.name);
      read += now.length;
    }
    assert.ok(read > 100, "the sample must match by feed, by name and by link");
  });

  it("each read can be answered from its index, with whole-table scans switched off", async (t) => {
    if (!trigram) return t.skip("pg_trgm is not installed in this database");
    await loadEmails(true);
    await db.query("ANALYZE crm_interactions; ANALYZE news_articles");
    const since = new Date(); since.setMonth(since.getMonth() - 24);
    const news = brandNewsQuery("co-alpha", { name: "Alpha's Kitchen", domain: "alphakitchen.example" });
    const OWN_INDEX = /Bitmap Index Scan on (crm_interactions|news_articles)_/;
    const reads: Array<[string, string, any[]]> = [
      ["company and contact emails", INTERACTIONS_90D_SQL, ["co-alpha"]],
      ["domain threads", DOMAIN_THREADS_90D_SQL, ["%@alpha.example"]],
      ["mailbox", KNOWN_CONTACTS_MAILBOX_SQL, [since, "%@alpha.example", "%@alpha.example%"]],
      ["senders", DOMAIN_SENDERS_SQL, ["%@alpha.example"]],
      ["email history", BRAND_EMAIL_ROWS_SQL, ["%@alpha.example", "co-alpha"]],
      ["news", news.sql, news.params],
    ];
    for (const [label, text, values] of reads) {
      const chosen = await plan(text, values);
      assert.match(chosen, OWN_INDEX, label);
      assert.doesNotMatch(chosen, /Seq Scan on (crm_interactions|news_articles)/, label);
    }
    // What the rewrite was for: the statements they replaced could only walk
    // the whole table, whatever indexes it had.
    const before: Array<[string, any[]]> = [
      [oldNews(news.sql), news.params], [OLD_INTERACTIONS_90D, ["co-alpha"]], [OLD_DOMAIN_THREADS_90D, ["%@alpha.example"]],
      [OLD_MAILBOX, [since, "%@alpha.example"]], [OLD_DOMAIN_SENDERS, ["%@alpha.example"]], [OLD_BRAND_EMAIL_ROWS, ["%@alpha.example", "co-alpha"]],
    ];
    for (const [text, values] of before) assert.doesNotMatch(await plan(text, values), OWN_INDEX);
  });
});
