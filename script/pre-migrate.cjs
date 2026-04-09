const { Client } = require("pg");

async function run() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("[pre-migrate] No DATABASE_URL, skipping");
    return;
  }

  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    const res = await client.query(
      `SELECT data_type FROM information_schema.columns 
       WHERE table_name = 'crm_contacts' AND column_name = 'bgp_allocation'`
    );
    const dataType = res.rows?.[0]?.data_type;

    if (dataType === "text") {
      console.log("[pre-migrate] Converting bgp_allocation from text to text[]...");
      await client.query(`
        ALTER TABLE "crm_contacts" 
        ALTER COLUMN "bgp_allocation" TYPE text[] 
        USING CASE 
          WHEN "bgp_allocation" IS NULL THEN NULL 
          WHEN "bgp_allocation" = '' THEN '{}'::text[]
          ELSE ARRAY["bgp_allocation"] 
        END
      `);
      console.log("[pre-migrate] bgp_allocation migration complete");
    } else {
      console.log("[pre-migrate] bgp_allocation already correct type:", dataType || "column not found");
    }

    const addColIfMissing = async (table, col, colType) => {
      const check = await client.query(
        `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
        [table, col]
      );
      if (check.rows.length === 0) {
        console.log(`[pre-migrate] Adding ${col} to ${table}...`);
        await client.query(`ALTER TABLE "${table}" ADD COLUMN "${col}" ${colType}`);
      }
    };

    await addColIfMissing("crm_requirements_leasing", "bgp_contact_user_ids", "text[]");
    await addColIfMissing("crm_requirements_investment", "bgp_contact_user_ids", "text[]");
  } catch (err) {
    console.error("[pre-migrate] Error:", err.message);
  } finally {
    await client.end();
  }
}

run();
