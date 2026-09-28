// One-off record fixes from the board sweeps (Woody, 2026-09-28: "can you
// just fix the wrong records?"). Runs once per database, flagged in
// system_settings; each fix is guarded on the value it replaces, so a record
// someone has already corrected by hand is left alone. Company merges go
// through mergeCompanyInto, so they show (and can be undone) on the dedupe
// screen.
import { landsecFloorLabel, isLandsecFloorCode } from "@shared/landsec-floor";

type Querier = { query: Function };

// secondary → primary: same Companies House number and domain, or the same
// firm under an old name / a stored description instead of a name.
const MERGES: Array<{ secondary: string; primary: string; why: string }> = [
  { secondary: "ff116de1-2038-4296-a21f-14a90c600c85", primary: "2d057816-e99e-4761-ab52-d3c2beb26805", why: "Gail's Bakery = Gail's (CH 06055393, gails.com)" },
  { secondary: "42c3f9f6-7e37-430f-b21c-4774024aecda", primary: "0da9d511-cb90-47b6-9d04-552ffd9da571", why: "Bonne Bouche Catering Limited = Bonne Bouche (CH 00855497)" },
  { secondary: "221ed8ba-bad1-4f06-9b2e-445b4c84f161", primary: "7961aba4-7afc-4cb2-8371-4d99858589bb", why: "Aberdeen Standard Investments is Aberdeen Group's former name" },
  { secondary: "2604c1c7-214d-4d71-b7d5-c9920bb9d823", primary: "44647491-7797-4912-aaff-4f71924ee081", why: "Söderberg stored with a broken character; same soderberg.uk" },
  { secondary: "5d3ccb68-54db-45ae-98f7-b0050b4c5505", primary: "45b44cd8-3995-408a-a293-1d684e5cc450", why: "Peugeot Invest record whose name was a CoStar tenancy note" },
];

export async function runRecordFixes(deps: { pool?: Querier } = {}) {
  const q: Querier = deps.pool ?? (await import("./db")).pool;
  const KEY = "migration:record_fixes_2026_09_28_v1";
  if ((await q.query(`SELECT 1 FROM system_settings WHERE key = $1`, [KEY])).rows.length) return;
  const log: Record<string, any> = {};
  const step = async (name: string, fn: () => Promise<any>) => {
    try { log[name] = await fn(); } catch (e: any) { log[name] = `failed: ${e?.message}`; console.warn(`[record-fixes] ${name} failed:`, e?.message); }
  };

  await step("merges", async () => {
    const { mergeCompanyInto } = await import("./brand-dedupe");
    const out: string[] = [];
    for (const m of MERGES) {
      const { rows } = await q.query(`SELECT id, merged_into_id FROM crm_companies WHERE id = ANY($1::text[])`, [[m.secondary, m.primary]]);
      const sec = rows.find((r: any) => r.id === m.secondary), prim = rows.find((r: any) => r.id === m.primary);
      if (!sec || !prim || sec.merged_into_id || prim.merged_into_id) { out.push(`skipped: ${m.why}`); continue; }
      const client = await (q as any).connect();
      try {
        await client.query("BEGIN");
        await mergeCompanyInto(client, m.primary, m.secondary, "record fixes 2026-09-28", m.why);
        await client.query("COMMIT");
        out.push(`merged: ${m.why}`);
      } catch (e: any) {
        await client.query("ROLLBACK");
        out.push(`failed: ${m.why} — ${e?.message}`);
      } finally { client.release(); }
    }
    return out;
  });

  await step("names", async () => {
    // Söderberg's surviving record was typed without the umlaut.
    const a = await q.query(`UPDATE crm_companies SET name = 'Söderberg', updated_at = now() WHERE id = '44647491-7797-4912-aaff-4f71924ee081' AND name = 'Soderberg'`);
    const b = await q.query(`UPDATE crm_companies SET industry = 'Real estate services', updated_at = now() WHERE id = 'a6cfa7d1-13b3-488a-8db0-f9d2ba223ec6' AND industry = 'Telecommunications - General'`);
    return { soderberg: a.rowCount, savillsIndustry: b.rowCount };
  });

  // Typos in stored names, whole words only.
  await step("spelling", async () => {
    const pairs: Array<[string, string]> = [["Chicwick", "Chiswick"], ["Pultney", "Pulteney"], ["Charring", "Charing"], ["Whiole", "Whole"], ["Nandos", "Nando's"]];
    const targets: Array<[string, string]> = [["crm_properties", "name"], ["crm_deals", "name"], ["available_units", "unit_name"], ["property_units", "unit_name"],
      ["tenancy_schedule_units", "unit_number"], ["tenancy_schedule_units", "premises"], ["leasing_schedule_units", "unit_name"]];
    const out: Record<string, number> = {};
    for (const [table, col] of targets) {
      for (const [bad, good] of pairs) {
        // "Nandos" only in deal titles — elsewhere it can be a stored legal name.
        if (bad === "Nandos" && table !== "crm_deals") continue;
        try {
          const r = await q.query(`UPDATE ${table} SET ${col} = regexp_replace(${col}, $1, $2, 'g') WHERE ${col} ~ $1`, [`\\m${bad}\\M`, good]);
          if (r.rowCount) out[`${table}.${col}:${bad}`] = r.rowCount;
        } catch (e: any) { out[`${table}.${col}:${bad}`] = -1; }
      }
    }
    return out;
  });

  // Kiosk K21 was saved as 0.54 sq ft — the real size isn't known, so it
  // shows as not recorded rather than a wrong figure.
  await step("impossibleSizes", async () =>
    (await q.query(`UPDATE available_units SET sqft = NULL WHERE id = '9dcdde62-cbc1-43e7-92be-3de7c20382a9' AND sqft < 5`)).rowCount);

  // 90 properties had their pin in address.lat/lng but not in the latitude /
  // longitude columns the Properties map reads (Bluewater among them).
  await step("coordinates", async () =>
    (await q.query(`UPDATE crm_properties SET latitude = address->>'lat', longitude = address->>'lng'
      WHERE (latitude IS NULL OR latitude = '') AND jsonb_typeof(address) = 'object'
        AND address->>'lat' ~ '^-?[0-9.]+$' AND address->>'lng' ~ '^-?[0-9.]+$'`)).rowCount);

  // Landsec floor codes (99/100/101…, MultiFloorUnits) → floor names. Where
  // a centre names its levels ("Bluewater - Lower Level"), each code takes
  // the name most of that property's rows carry for it.
  await step("floors", async () => {
    const { rows } = await q.query(`SELECT id, property_id, floor_level, unit_number, premises FROM tenancy_schedule_units WHERE floor_level IS NOT NULL`);
    const coded = rows.filter((r: any) => isLandsecFloorCode(r.floor_level));
    const votes = new Map<string, Map<string, number>>();
    for (const r of coded) {
      const named = landsecFloorLabel(r.floor_level, `${r.unit_number || ""} ${r.premises || ""}`);
      if (!named || !/ Level$/.test(named)) continue;
      const k = `${r.property_id}|${String(r.floor_level).toLowerCase()}`;
      const m = votes.get(k) || new Map<string, number>();
      m.set(named, (m.get(named) || 0) + 1);
      votes.set(k, m);
    }
    let n = 0;
    for (const r of coded) {
      const own = landsecFloorLabel(r.floor_level, `${r.unit_number || ""} ${r.premises || ""}`);
      const vote = votes.get(`${r.property_id}|${String(r.floor_level).toLowerCase()}`);
      const majority = vote ? [...vote.entries()].sort((a, b) => b[1] - a[1])[0][0] : null;
      const label = own && / Level$/.test(own) ? own : majority || own;
      if (label && label !== r.floor_level) n += (await q.query(`UPDATE tenancy_schedule_units SET floor_level = $1 WHERE id = $2 AND floor_level = $3`, [label, r.id, r.floor_level])).rowCount || 0;
    }
    // Same centres also held bare "Lower" / "Upper" rows.
    n += (await q.query(`UPDATE tenancy_schedule_units t SET floor_level = t.floor_level || ' Level'
      WHERE t.floor_level IN ('Lower', 'Upper') AND EXISTS (SELECT 1 FROM tenancy_schedule_units o WHERE o.property_id = t.property_id AND o.floor_level = t.floor_level || ' Level')`)).rowCount || 0;
    return n;
  });

  // A company named "Colliers / Grosvenor / Bruce Gillingham Pollard" — three
  // firms in one row. Removed only if nothing points at it.
  await step("junkCompany", async () => {
    const id = "33091655-90a9-4ae3-a124-b813ff167501";
    const { COMPANY_REFS } = await import("./brand-dedupe");
    let used = 0;
    for (const { table, column } of [...COMPANY_REFS, { table: "crm_property_agents", column: "company_id" }]) {
      try { used += Number((await q.query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE ${column} = $1`, [id])).rows[0]?.n || 0); } catch { /* column absent */ }
    }
    if (used) return `kept: ${used} links`;
    return (await q.query(`DELETE FROM crm_companies WHERE id = $1 AND name = 'Colliers / Grosvenor / Bruce Gillingham Pollard'`, [id])).rowCount;
  });

  await q.query(`INSERT INTO system_settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO NOTHING`, [KEY, JSON.stringify({ ...log, at: new Date().toISOString() })]);
  console.log(`[record-fixes]`, JSON.stringify(log));
}

// The master unit record (property_units) holds the name the Letting Tracker
// shows first — the first run fixed only the listing copy.
export async function runUnitNameFixes(deps: { pool?: Querier } = {}) {
  const q: Querier = deps.pool ?? (await import("./db")).pool;
  const KEY = "migration:record_fixes_unit_names_v2";
  if ((await q.query(`SELECT 1 FROM system_settings WHERE key = $1`, [KEY])).rows.length) return;
  const r = await q.query(`UPDATE property_units SET unit_name = regexp_replace(unit_name, '\\mWhiole\\M', 'Whole', 'g') WHERE unit_name ~ '\\mWhiole\\M'`);
  const k = await q.query(`UPDATE property_units SET sqft = NULL WHERE sqft < 5 AND id IN (SELECT unit_id FROM available_units WHERE id = '9dcdde62-cbc1-43e7-92be-3de7c20382a9')`);
  await q.query(`INSERT INTO system_settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO NOTHING`, [KEY, JSON.stringify({ names: r.rowCount, sizes: k.rowCount, at: new Date().toISOString() })]);
  console.log(`[record-fixes] unit names ${r.rowCount}, sizes ${k.rowCount}`);
}

// Covenant grades were read off small subsidiaries: Zara's UK stores trade
// through Inditex's ITX UK Limited (not Zara Retail Limited, £43k net
// assets); Hammerson is Hammerson plc (not Hammerson Operations Limited).
// performAutoKyc keeps a stored number over a manual one, so the old number
// is cleared first; the check then verifies the new one on Companies House
// and refreshes the stored profile, officers and KYC record.
export async function runCompaniesHouseFixes(deps: { pool?: Querier } = {}) {
  const q: Querier = deps.pool ?? (await import("./db")).pool;
  const KEY = "migration:record_fixes_ch_entities_v2";
  if ((await q.query(`SELECT 1 FROM system_settings WHERE key = $1`, [KEY])).rows.length) return;
  const { performAutoKyc } = await import("./companies-house");
  const fixes = [
    { id: "488d5558-3fbc-41b9-a88c-3381ff3d864a", from: "08822115", to: "02245999" },
    { id: "290d7451-3cff-4f6f-ab78-7712eea90800", from: "04125216", to: "00360632" },
  ];
  const out: string[] = [];
  for (const f of fixes) {
    try {
      const { rows } = await q.query(`SELECT companies_house_number, uk_entity_name FROM crm_companies WHERE id = $1`, [f.id]);
      // NULL too: a restart between clearing and re-checking leaves it blank.
      const current = rows[0]?.companies_house_number ?? null;
      if (current !== f.from && current !== null) { out.push(`${f.to}: skipped (now ${current})`); continue; }
      await q.query(`UPDATE crm_companies SET companies_house_number = NULL, uk_entity_name = NULL WHERE id = $1`, [f.id]);
      const r: any = await performAutoKyc(f.id, { manualChNumber: f.to });
      if (r?.success && r?.companyNumber === f.to) { out.push(`${f.to}: ok`); continue; }
      // Didn't verify — put the old values back rather than leave it blank.
      await q.query(`UPDATE crm_companies SET companies_house_number = COALESCE(companies_house_number, $2), uk_entity_name = COALESCE(uk_entity_name, $3) WHERE id = $1`,
        [f.id, f.from, rows[0]?.uk_entity_name ?? null]);
      out.push(`${f.to}: not confirmed — ${r?.message || "unknown"}`);
    } catch (e: any) { out.push(`${f.to}: failed — ${e?.message}`); }
  }
  await q.query(`INSERT INTO system_settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO NOTHING`, [KEY, JSON.stringify({ out, at: new Date().toISOString() })]);
  console.log(`[record-fixes] companies house:`, JSON.stringify(out));
}

// People Woody has said have left (2026-09-28: "Richard Benson has left").
export async function runContactLeftFixes(deps: { pool?: Querier } = {}) {
  const q: Querier = deps.pool ?? (await import("./db")).pool;
  const KEY = "migration:contacts_left_2026_09_28_v1";
  if ((await q.query(`SELECT 1 FROM system_settings WHERE key = $1`, [KEY])).rows.length) return;
  const r = await q.query(`INSERT INTO contact_left_companies (contact_id, company_id, noted_by, note)
    SELECT id, company_id, 'Woody Bruce', 'Has left Ardent' FROM crm_contacts
     WHERE id = 'e831993f-5072-4913-838c-d7bcdb45a302' AND company_id = '02d1070e-49c8-4798-96df-5777702ff70a'
    ON CONFLICT (contact_id, company_id) DO NOTHING`);
  await q.query(`INSERT INTO system_settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO NOTHING`, [KEY, JSON.stringify({ marked: r.rowCount, at: new Date().toISOString() })]);
}
