import { db } from "./db";
import { pool } from "./db";
import { projects, diaryEntries, contacts, users } from "@shared/schema";
import { sql } from "drizzle-orm";
import { hashPassword } from "./auth";
import { readFileSync, existsSync } from "fs";
import { gunzipSync } from "zlib";
import { join, dirname } from "path";

const TEAM_MEMBERS = [
  { name: "Woody Bruce", username: "woody@brucegillinghampollard.com", email: "woody@brucegillinghampollard.com", phone: "+44 (0)7980 313 675", role: "Managing Director - Board", department: "Investment", team: "Investment" },
  { name: "Cara Milligan", username: "cara@brucegillinghampollard.com", email: "cara@brucegillinghampollard.com", phone: "", role: "PA - National", department: "Office / Corporate", team: "Office / Corporate" },
  { name: "Harriette Walker-Clark", username: "harriette@brucegillinghampollard.com", email: "harriette@brucegillinghampollard.com", phone: "", role: "PA & Office Manager", department: "Office / Corporate", team: "Office / Corporate" },
  { name: "Layla O'Driscoll", username: "layla@brucegillinghampollard.com", email: "layla@brucegillinghampollard.com", phone: "", role: "PA & Office Manager", department: "Office / Corporate", team: "Office / Corporate" },
  { name: "Nick Goodman", username: "nickgoodman@brucegillinghampollard.com", email: "nickgoodman@brucegillinghampollard.com", phone: "+44 (0)7818 012 432", role: "Consultant", department: "Investment", team: "Investment" },
  { name: "Jack Barratt", username: "jack@brucegillinghampollard.com", email: "jack@brucegillinghampollard.com", phone: "+44 (0)7788 215 044", role: "Equity Director, Head of Investment", department: "Investment", team: "Investment" },
  { name: "Nick Halley", username: "nick@brucegillinghampollard.com", email: "nick@brucegillinghampollard.com", phone: "+44 (0)7766 042 736", role: "Director", department: "Investment", team: "Investment" },
  { name: "Ollie Wilkinson", username: "ollie@brucegillinghampollard.com", email: "ollie@brucegillinghampollard.com", phone: "+44 (0)7736 869 317", role: "Associate Director", department: "Investment", team: "Investment" },
  { name: "Jonny Palmer", username: "jonny@brucegillinghampollard.com", email: "jonny@brucegillinghampollard.com", phone: "+44 (0)7506 439 429", role: "Graduate", department: "Investment", team: "Investment" },
  { name: "Peter Wood", username: "peter@brucegillinghampollard.com", email: "peter@brucegillinghampollard.com", phone: "+44 (0)7872 602 336", role: "Head of Lease Consultancy", department: "Lease Advisory", team: "Lease Advisory" },
  { name: "Tom Cater", username: "tom@brucegillinghampollard.com", email: "tom@brucegillinghampollard.com", phone: "+44 (0)7947 484 902", role: "Associate Director", department: "Lease Advisory", team: "Lease Advisory" },
  { name: "Victoria Broadhead", username: "victoria@brucegillinghampollard.com", email: "victoria@brucegillinghampollard.com", phone: "+44 (0)7793 158 133", role: "Head of National", department: "National Leasing", team: "National Leasing" },
  { name: "Lucy Gardiner", username: "lucyg@brucegillinghampollard.com", email: "lucyg@brucegillinghampollard.com", phone: "+44 (0)7741 877 452", role: "Director", department: "National Leasing", team: "National Leasing" },
  { name: "Rob Barnes", username: "rob@brucegillinghampollard.com", email: "rob@brucegillinghampollard.com", phone: "+44 (0)7494 751 653", role: "Surveyor", department: "National Leasing", team: "National Leasing" },
  { name: "Luke Donohoe", username: "luke@brucegillinghampollard.com", email: "luke@brucegillinghampollard.com", phone: "+44(0)7983 855 926", role: "Graduate Surveyor", department: "National Leasing", team: "National Leasing" },
  { name: "Tracey Pollard", username: "tracey@brucegillinghampollard.com", email: "tracey@brucegillinghampollard.com", phone: "+44 (0)7779 323 306", role: "Head of Development", department: "Development", team: "Development" },
  { name: "Alex Todd", username: "alext@brucegillinghampollard.com", email: "alext@brucegillinghampollard.com", phone: "+44 (0)7526 504 806", role: "Senior Surveyor", department: "Development", team: "Development" },
  { name: "Libby Evans", username: "libbye@brucegillinghampollard.com", email: "libbye@brucegillinghampollard.com", phone: "+44(0)7931 462 768", role: "Graduate Surveyor", department: "Development", team: "Development" },
  { name: "Harry Elliott", username: "harrye@brucegillinghampollard.com", email: "harrye@brucegillinghampollard.com", phone: "+44 (0)7568 367 777", role: "Director", department: "Tenant Rep", team: "Tenant Rep" },
  { name: "Emily Dumbell", username: "emily@brucegillinghampollard.com", email: "emily@brucegillinghampollard.com", phone: "+44 (0)7805 259 793", role: "Director", department: "Tenant Rep", team: "Tenant Rep" },
  { name: "Evie North", username: "evie@brucegillinghampollard.com", email: "evie@brucegillinghampollard.com", phone: "+44 (0)7595 349 057", role: "Associate Director", department: "Tenant Rep", team: "Tenant Rep" },
  { name: "Charlotte Roberts", username: "charlotte@brucegillinghampollard.com", email: "charlotte@brucegillinghampollard.com", phone: "+44 (0)7738 448 338", role: "Equity Director, Co-Head London Estates", department: "London Leasing", team: "London Leasing" },
  { name: "Rupert Bentley-Smith", username: "rupert@brucegillinghampollard.com", email: "rupert@brucegillinghampollard.com", phone: "+44 (0)7876 354 160", role: "Equity Director, Co-Head London Estates", department: "London Leasing", team: "London Leasing" },
  { name: "Lizzie Knights", username: "lizzie@brucegillinghampollard.com", email: "lizzie@brucegillinghampollard.com", phone: "+44 (0)7511 902 073", role: "Director", department: "London Leasing", team: "London Leasing" },
  { name: "Lucy Cope", username: "lucy@brucegillinghampollard.com", email: "lucy@brucegillinghampollard.com", phone: "+44 (0)7595 267 866", role: "Associate Director", department: "London Leasing", team: "London Leasing" },
  { name: "Emily Cann", username: "emilyc@brucegillinghampollard.com", email: "emilyc@brucegillinghampollard.com", phone: "+44 (0)7516 660 791", role: "Graduate Surveyor", department: "London Leasing", team: "London Leasing" },
  { name: "Will Penfold", username: "willp@brucegillinghampollard.com", email: "willp@brucegillinghampollard.com", phone: "+44 (0)7760 881 270", role: "Graduate Surveyor", department: "London Leasing", team: "London Leasing" },
  { name: "Johnny", username: "johnny@brucegillinghampollard.com", email: "johnny@brucegillinghampollard.com", phone: "", role: "", department: "", team: "" },
  { name: "Mark Warne", username: "mark.warne@landsec.com", email: "mark.warne@landsec.com", phone: "", role: "Client", department: "Landsec", team: "Landsec" },
];

const OLD_TO_NEW_USERNAME: Record<string, string> = {
  woody: "woody@brucegillinghampollard.com",
  cara: "cara@brucegillinghampollard.com",
  harriette: "harriette@brucegillinghampollard.com",
  layla: "layla@brucegillinghampollard.com",
  nickgoodman: "nickgoodman@brucegillinghampollard.com",
  jack: "jack@brucegillinghampollard.com",
  nick: "nick@brucegillinghampollard.com",
  ollie: "ollie@brucegillinghampollard.com",
  jonny: "jonny@brucegillinghampollard.com",
  peter: "peter@brucegillinghampollard.com",
  tom: "tom@brucegillinghampollard.com",
  victoria: "victoria@brucegillinghampollard.com",
  lucyg: "lucyg@brucegillinghampollard.com",
  rob: "rob@brucegillinghampollard.com",
  luke: "luke@brucegillinghampollard.com",
  tracey: "tracey@brucegillinghampollard.com",
  alext: "alext@brucegillinghampollard.com",
  libbye: "libbye@brucegillinghampollard.com",
  harrye: "harrye@brucegillinghampollard.com",
  emily: "emily@brucegillinghampollard.com",
  evie: "evie@brucegillinghampollard.com",
  charlotte: "charlotte@brucegillinghampollard.com",
  rupert: "rupert@brucegillinghampollard.com",
  lizzie: "lizzie@brucegillinghampollard.com",
  lucy: "lucy@brucegillinghampollard.com",
  emilyc: "emilyc@brucegillinghampollard.com",
  willp: "willp@brucegillinghampollard.com",
};

async function migrateUsernamesToEmail() {
  for (const [oldUsername, newUsername] of Object.entries(OLD_TO_NEW_USERNAME)) {
    const existing = await db.select().from(users).where(sql`${users.username} = ${oldUsername}`);
    if (existing.length > 0) {
      await db.execute(sql`UPDATE ${users} SET username = ${newUsername} WHERE username = ${oldUsername}`);
    }
  }
  console.log("Migrated usernames to email addresses");
}

export async function seedDatabase() {
  await migrateUsernamesToEmail();

  const existingProjects = await db.select().from(projects);
  if (existingProjects.length > 0) {
    const existingUsers = await db.select().from(users);
    if (existingUsers.length === 0) {
      await seedUsers();
    }
    await seedFromFile();
    await seedInvestmentTracker();
    await seedLettingTracker();
    return;
  }

  console.log("Seeding database...");

  await seedUsers();

  await db.insert(projects).values([
    {
      name: "67 Pimlico Road",
      slug: "67-pimlico",
      address: "67 Pimlico Road, Belgravia, London SW1W 8NE",
      status: "active",
      type: "retail",
      description: "Prime retail unit in the heart of Belgravia. Currently under negotiation with a new tenant for a boutique retail concept. Strong footfall location with excellent neighbouring occupiers.",
      rentPA: 55000,
      size: "1,200 sqft",
      lastUpdated: "2h ago",
      assignee: "Rupert",
      priority: "high",
    },
    {
      name: "Project Apollo",
      slug: "project-apollo",
      address: "15-17 Motcomb Street, London SW1X 8LB",
      status: "active",
      type: "mixed-use",
      description: "Mixed-use development opportunity on Motcomb Street. Involves ground floor retail with upper floor residential conversion. Planning application pending.",
      rentPA: 120000,
      size: "3,500 sqft",
      lastUpdated: "2h ago",
      assignee: "Sohail",
      priority: "high",
    },
    {
      name: "Grosvenor St.",
      slug: "grosvenor-st",
      address: "22 Grosvenor Street, Mayfair, London W1K 4QJ",
      status: "active",
      type: "office",
      description: "Grade A office space in Mayfair. Full refurbishment completed Q2 2025. Targeting premium occupiers in the financial and professional services sector.",
      rentPA: 95000,
      size: "2,800 sqft",
      lastUpdated: "Yesterday",
      assignee: "Woody",
      priority: "medium",
    },
    {
      name: "Elizabeth Street",
      slug: "elizabeth-street",
      address: "45 Elizabeth Street, Belgravia, London SW1W 9PA",
      status: "pipeline",
      type: "retail",
      description: "Boutique retail premises on Elizabeth Street. Instruction expected following lease expiry in Q4 2025.",
      rentPA: 42000,
      size: "800 sqft",
      lastUpdated: "3 days ago",
      assignee: "Lucy",
      priority: "medium",
    },
    {
      name: "Sloane Avenue",
      slug: "sloane-avenue",
      address: "89 Sloane Avenue, Chelsea, London SW3 3DX",
      status: "pipeline",
      type: "restaurant",
      description: "Restaurant premises on Sloane Avenue. Existing occupier serving notice. Pre-marketing assessment underway.",
      rentPA: 78000,
      size: "1,800 sqft",
      lastUpdated: "Last week",
      assignee: "Rupert",
      priority: "low",
    },
  ]);


  await db.insert(diaryEntries).values([
    { title: "Meeting with Grosvenor Estates", person: "Lucy", project: "67 Pimlico Road", day: "Mon 6th", time: "10:00 AM", type: "meeting" },
    { title: "Site visit & inspection", person: "Sohail", project: "Project Apollo", day: "Tue 7th", time: "2:00 PM", type: "visit" },
    { title: "Client presentation", person: "Woody", project: "Grosvenor St.", day: "Wed 8th", time: "11:00 AM", type: "presentation" },
    { title: "Valuation review", person: "Rupert", project: "67 Pimlico Road", day: "Thu 9th", time: "3:00 PM", type: "review" },
    { title: "Team strategy session", person: "Rupert", project: null, day: "Fri 10th", time: "9:30 AM", type: "meeting" },
  ]);

  await db.insert(contacts).values([
    { name: "James Henderson", company: "Ottolenghi Group", email: "james@ottolenghi.co.uk", phone: "+44 20 7123 4567", role: "Head of Property", type: "client" },
    { name: "Sarah Mitchell", company: "The Ivy Collection", email: "sarah.m@theivycollection.com", phone: "+44 20 7234 5678", role: "Property Director", type: "client" },
    { name: "Richard Hughes", company: "Savills", email: "rhughes@savills.com", phone: "+44 20 7345 6789", role: "Partner", type: "agent" },
    { name: "Hugh Seaborn", company: "Cadogan Estates", email: "h.seaborn@cadogan.co.uk", phone: "+44 20 7456 7890", role: "Chief Executive", type: "landlord" },
    { name: "Emma Williams", company: "Aesop", email: "emma.w@aesop.com", phone: "+44 20 7567 8901", role: "Retail Development Manager", type: "client" },
    { name: "David Foster", company: "CBRE", email: "david.foster@cbre.com", phone: "+44 20 7678 9012", role: "Senior Surveyor", type: "surveyor" },
    { name: "Lucy Chen", company: "BGP", email: "lucy@bgp.co.uk", phone: "+44 20 7789 0123", role: "Associate", type: "internal" },
    { name: "Sohail Khan", company: "BGP", email: "sohail@bgp.co.uk", phone: "+44 20 7890 1234", role: "Associate", type: "internal" },
  ]);

  console.log("Database seeded successfully!");
}

async function seedUsers() {
  console.log("Seeding user accounts...");
  const hashedPassword = await hashPassword("B@nd0077!");

  for (const member of TEAM_MEMBERS) {
    const existing = await db.select().from(users).where(sql`${users.username} = ${member.username}`);
    if (existing.length === 0) {
      await db.insert(users).values({
        username: member.username,
        password: hashedPassword,
        name: member.name,
        email: member.email,
        phone: member.phone || null,
        role: member.role || null,
        department: member.department,
        team: (member as any).team || null,
      });
    }
  }

  console.log(`${TEAM_MEMBERS.length} user accounts seeded!`);
}

async function seedFromFile() {
  const paths = [
    join(process.cwd(), "dist", "seed-data.sql.gz"),
    join(process.cwd(), "server", "seed-data.sql.gz"),
    join(dirname(process.argv[1] || __filename), "seed-data.sql.gz"),
  ];
  const seedPath = paths.find(p => existsSync(p));
  if (!seedPath) {
    console.log("No seed-data.sql.gz found at any expected location, skipping");
    return;
  }
  console.log("Found seed data at:", seedPath);

  const countRows = await db.execute(sql`SELECT count(*)::int as c FROM crm_companies`);
  const countResult = Array.isArray(countRows) ? countRows[0] : (countRows as any)?.rows?.[0];
  const count = (countResult as any)?.c ?? 0;
  if (count > 0) {
    console.log(`Database already has ${count} companies, skipping data seed`);
    return;
  }

  console.log("Database is empty — importing seed data...");
  const compressed = readFileSync(seedPath);
  const sqlContent = gunzipSync(compressed).toString("utf-8");
  const result = await executeSeedSql(sqlContent);
  console.log(`Seed complete: ${result.imported} imported, ${result.errors.length} errors`);
  if (result.errors.length > 0) {
    console.log("First errors:", result.errors.slice(0, 5));
  }
}

export async function executeSeedSql(sqlContent: string): Promise<{ imported: number; errors: string[] }> {
  const client = await pool.connect();
  const errors: string[] = [];
  let imported = 0;
  let errorCount = 0;
  try {
    const statements: string[] = [];
    let current = '';
    let inQuote = false;
    let escaped = false;
    for (let i = 0; i < sqlContent.length; i++) {
      const ch = sqlContent[i];
      if (escaped) { current += ch; escaped = false; continue; }
      if (ch === "'" && !escaped) { inQuote = !inQuote; current += ch; continue; }
      if (ch === '\\' && inQuote) { current += ch; escaped = true; continue; }
      if (ch === ';' && !inQuote) {
        const trimmed = current.trim();
        if (trimmed && !trimmed.startsWith('--') && !trimmed.startsWith('SET ') && !trimmed.startsWith('SELECT pg_catalog') && !trimmed.startsWith('\\')) {
          statements.push(trimmed);
        }
        current = '';
        continue;
      }
      current += ch;
    }
    if (current.trim()) {
      const trimmed = current.trim();
      if (trimmed && !trimmed.startsWith('--') && !trimmed.startsWith('SET ') && !trimmed.startsWith('\\')) {
        statements.push(trimmed);
      }
    }

    for (const stmt of statements) {
      try {
        await client.query(stmt);
        imported++;
      } catch (e: any) {
        if (e.code === "23505") continue;
        errorCount++;
        if (errors.length < 10) errors.push(e.message);
      }
    }
    console.log(`Seed data imported: ${imported} statements executed, ${errorCount} errors`);
  } catch (err: any) {
    console.error("Seed data import failed:", err);
    errors.push(err.message);
  } finally {
    client.release();
  }
  return { imported, errors: errors.slice(0, 10) };
}

async function seedInvestmentTracker() {
  try {
    const countResult = await pool.query("SELECT count(*)::int as c FROM investment_tracker");
    const existingCount = countResult.rows[0]?.c ?? 0;

    const paths = [
      join(process.cwd(), "dist", "seed-investment-tracker.sql.gz"),
      join(process.cwd(), "server", "seed-investment-tracker.sql.gz"),
      join(dirname(process.argv[1] || __filename), "seed-investment-tracker.sql.gz"),
    ];
    const seedPath = paths.find(p => existsSync(p));
    if (!seedPath) {
      console.log("[seed] No seed-investment-tracker.sql.gz found, skipping");
      return;
    }

    const compressed = readFileSync(seedPath);
    const sqlContent = gunzipSync(compressed).toString("utf-8");
    const expectedCount = (sqlContent.match(/^INSERT /gm) || []).length;

    if (existingCount >= expectedCount) {
      return;
    }

    console.log(`[seed] Investment tracker has ${existingCount}/${expectedCount} records — importing...`);
    const client = await pool.connect();
    try {
      await client.query("DELETE FROM investment_tracker");
      await client.query("SET session_replication_role = 'replica'");
      const statements = sqlContent.split('\n').filter(s => s.trim().startsWith('INSERT'));
      let imported = 0;
      let errors = 0;
      for (const stmt of statements) {
        try {
          await client.query(stmt);
          imported++;
        } catch (e: any) {
          errors++;
          if (errors <= 3) console.log(`[seed] IT error: ${e.message.slice(0, 100)}`);
        }
      }
      await client.query("SET session_replication_role = 'origin'");
      console.log(`[seed] Investment tracker seed complete: ${imported} imported, ${errors} errors`);
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error("[seed] Investment tracker seed error:", err.message);
  }
}

async function seedLettingTracker() {
  try {
    const countResult = await pool.query("SELECT count(*)::int as c FROM available_units");
    const existingCount = countResult.rows[0]?.c ?? 0;

    const paths = [
      join(process.cwd(), "dist", "seed-letting-tracker.sql.gz"),
      join(process.cwd(), "server", "seed-letting-tracker.sql.gz"),
      join(dirname(process.argv[1] || __filename), "seed-letting-tracker.sql.gz"),
    ];
    const seedPath = paths.find(p => existsSync(p));
    if (!seedPath) return;

    const compressed = readFileSync(seedPath);
    const sqlContent = gunzipSync(compressed).toString("utf-8");
    const expectedCount = (sqlContent.match(/INSERT INTO public\.available_units/g) || []).length;

    if (existingCount >= expectedCount) return;

    console.log(`[seed] Letting tracker has ${existingCount}/${expectedCount} records — importing...`);
    const client = await pool.connect();
    try {
      await client.query("DELETE FROM unit_marketing_files");
      await client.query("DELETE FROM unit_offers");
      await client.query("DELETE FROM unit_viewings");
      await client.query("DELETE FROM available_units");
      await client.query("SET session_replication_role = 'replica'");
      const statements = sqlContent.split('\n').filter(s => s.trim().startsWith('INSERT'));
      let imported = 0;
      for (const stmt of statements) {
        try { await client.query(stmt); imported++; } catch {}
      }
      await client.query("SET session_replication_role = 'origin'");
      console.log(`[seed] Letting tracker seed complete: ${imported} imported`);
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error("[seed] Letting tracker seed error:", err.message);
  }
}
