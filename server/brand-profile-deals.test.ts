/**
 * brand-profile-deals.test.ts — deal totals independent of the 20-row cap.
 *
 * The company-profile endpoint caps its deal list at LIMIT 20, then used to
 * derive totalDeals / completedDeals / totalFees / team from that capped set,
 * classifying "completed" with a substring match (`includes("complet") ||
 * includes("won")`) that missed the canonical status codes. The fix aggregates
 * over the FULL scoped set with the canonical vocabulary from
 * shared/deal-status.ts (COM/INV completed; WIT/COM/INV closed).
 *
 * Run with: node --import tsx --test server/brand-profile-deals.test.ts
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import pg from "pg";
import {
  COMPLETED_DEAL_STATUSES,
  isCompletedDealStatus,
  isActiveDealStatus,
  completedStatusSql,
  closedStatusSql,
  dealTotalsSql,
  BRAND_DEAL_LIST_LIMIT,
  BRAND_DEAL_PROPERTY_SCOPE,
  BRAND_LIVE_LOCATIONS_PROPERTY_SCOPE,
  BRAND_SCHEME_PROPERTY_SCOPE,
  brandDealList,
  brandDealListSql,
  brandLiveLocationsSql,
} from "./brand-profile-deals";
import { clientScoreView, schemeLimitedScoreLabel, schemeLimitedScoreView } from "./hunter-score";
import { CLOSED_STATUSES, TERMINAL_STATUSES } from "../shared/deal-status";

describe("COMPLETED_DEAL_STATUSES", () => {
  it("is derived from the shared closed/terminal lists, not hand-rolled", () => {
    assert.deepEqual(
      COMPLETED_DEAL_STATUSES,
      CLOSED_STATUSES.filter((s) => !(TERMINAL_STATUSES as readonly string[]).includes(s)),
    );
  });

  it("is exactly COM and INV", () => {
    assert.deepEqual(COMPLETED_DEAL_STATUSES, ["COM", "INV"]);
  });
});

describe("isCompletedDealStatus", () => {
  it("accepts canonical completed codes", () => {
    assert.equal(isCompletedDealStatus("COM"), true);
    assert.equal(isCompletedDealStatus("INV"), true);
  });

  it("accepts lowercase canonical variants", () => {
    assert.equal(isCompletedDealStatus("com"), true);
    assert.equal(isCompletedDealStatus("inv"), true);
  });

  it("accepts legacy free-text variants", () => {
    assert.equal(isCompletedDealStatus("completed"), true);
    assert.equal(isCompletedDealStatus("Complete"), true);
    assert.equal(isCompletedDealStatus("let"), true);
    assert.equal(isCompletedDealStatus("invoiced"), true);
    assert.equal(isCompletedDealStatus("occupied"), true);
  });

  it("rejects archived/withdrawn statuses", () => {
    assert.equal(isCompletedDealStatus("WIT"), false);
    assert.equal(isCompletedDealStatus("wit"), false);
    assert.equal(isCompletedDealStatus("withdrawn"), false);
    assert.equal(isCompletedDealStatus("lost"), false);
    assert.equal(isCompletedDealStatus("dead"), false);
  });

  it("rejects live pipeline statuses", () => {
    for (const s of ["OPP", "REP", "SPEC", "LIVE", "AVA", "NEG", "HOT", "SOL", "EXC"]) {
      assert.equal(isCompletedDealStatus(s), false, s);
    }
  });

  it("rejects empty/unknown statuses", () => {
    assert.equal(isCompletedDealStatus(null), false);
    assert.equal(isCompletedDealStatus(undefined), false);
    assert.equal(isCompletedDealStatus(""), false);
    assert.equal(isCompletedDealStatus("   "), false);
    assert.equal(isCompletedDealStatus("nonsense"), false);
  });
});

describe("isActiveDealStatus", () => {
  it("treats closed statuses (WIT/COM/INV) as not active", () => {
    assert.equal(isActiveDealStatus("WIT"), false);
    assert.equal(isActiveDealStatus("COM"), false);
    assert.equal(isActiveDealStatus("INV"), false);
    assert.equal(isActiveDealStatus("withdrawn"), false);
    assert.equal(isActiveDealStatus("completed"), false);
  });

  it("treats live pipeline statuses as active", () => {
    for (const s of ["NEG", "HOT", "SOL", "EXC", "AVA", "LIVE"]) {
      assert.equal(isActiveDealStatus(s), true, s);
    }
  });

  it("treats empty/unknown statuses as active (prior convention)", () => {
    assert.equal(isActiveDealStatus(null), true);
    assert.equal(isActiveDealStatus(""), true);
    assert.equal(isActiveDealStatus("nonsense"), true);
  });
});

describe("completedStatusSql / closedStatusSql", () => {
  it("completed SQL matches canonical COM and INV, case-insensitively", () => {
    const sql = completedStatusSql("d.status");
    assert.match(sql, /UPPER\(BTRIM\(COALESCE\(d\.status, ''\)\)\) IN \('COM', 'INV'\)/);
  });

  it("completed SQL excludes WIT (withdrawn is closed, not completed)", () => {
    assert.doesNotMatch(completedStatusSql("d.status"), /'WIT'/);
  });

  it("closed SQL includes WIT, COM, INV and ARCH", () => {
    const sql = closedStatusSql("d.status");
    for (const code of ["WIT", "COM", "INV", "ARCH"]) {
      assert.ok(sql.includes(`'${code}'`), code);
    }
  });
});

describe("dealTotalsSql", () => {
  const sql = dealTotalsSql(" AND (d.landlord_id = $2 OR d.vendor_id = $2 OR d.purchaser_id = $2)");

  it("runs over the full scoped set — no LIMIT", () => {
    assert.doesNotMatch(sql, /\bLIMIT\b/i);
  });

  it("keeps the same party-match WHERE as the list query", () => {
    assert.match(sql, /WHERE \(d\.tenant_id = \$1 OR d\.landlord_id = \$1 OR d\.vendor_id = \$1 OR d\.purchaser_id = \$1\)/);
  });

  it("embeds the client-counterparty scope clause verbatim", () => {
    assert.ok(sql.includes(" AND (d.landlord_id = $2 OR d.vendor_id = $2 OR d.purchaser_id = $2)"));
  });

  it("counts completed via the canonical COM/INV filter and completed_at", () => {
    assert.match(sql, /COUNT\(\*\) FILTER \(WHERE UPPER\(BTRIM\(COALESCE\(status, ''\)\)\) IN \('COM', 'INV'\) OR completed_at IS NOT NULL\)/);
  });

  it("counts active as NOT closed (WIT/COM/INV/ARCH)", () => {
    assert.match(sql, /COUNT\(\*\) FILTER \(WHERE NOT UPPER\(BTRIM\(COALESCE\(status, ''\)\)\) IN \('WIT', 'COM', 'INV', 'ARCH'\)\)/);
  });

  it("sums fees and unions distinct team + internal_agent members", () => {
    assert.match(sql, /COALESCE\(SUM\(fee\), 0\)::float AS total_fees/);
    assert.match(sql, /SELECT unnest\(s\.team\) AS m\s+UNION\s+SELECT unnest\(s\.internal_agent\)/);
    assert.match(sql, /SELECT DISTINCT m/);
  });

  it("works with an empty scope clause (staff view)", () => {
    const staffSql = dealTotalsSql("");
    assert.doesNotMatch(staffSql, /\$2/);
    assert.doesNotMatch(staffSql, /\bLIMIT\b/i);
  });
});

// Follow-up (fix round 1): the ChatBGP brand-profile tool (server/chatbgp.ts)
// consumed the old array shape — full.activeDeals?.slice(...) threw a TypeError
// once activeDeals became a full-set count, failing every company-profile
// lookup. Assert the fixed source reads counts from the numeric fields and
// slices the capped row arrays.
describe("chatbgp.ts brand-profile tool", () => {
  const src = readFileSync(new URL("./chatbgp.ts", import.meta.url), "utf8");
  // Isolate the profile-tool block that reads the deal fields.
  const anchor = src.indexOf("completedDealsCount");
  const block = anchor === -1 ? "" : src.slice(anchor, anchor + 700);

  it("reads counts from the numeric completedDeals/activeDeals fields", () => {
    assert.ok(anchor !== -1, "profile tool block not found");
    assert.match(block, /full\.completedDeals \?\?/);
    assert.match(block, /full\.activeDeals \?\?/);
  });

  it("slices the capped row arrays, never the count fields", () => {
    assert.match(block, /full\.activeDealRows\?\.slice\(0, 10\)/);
    assert.doesNotMatch(block, /full\.activeDeals\?\.slice/);
    assert.doesNotMatch(block, /full\.activeDeals\?\.length/);
    assert.doesNotMatch(block, /full\.completedDeals\?\.length/);
  });

  // Follow-up (final review): the profile API has only ever decorated contacts
  // with last_interaction_at, so last_contacted_at reads were always null —
  // and contacts[0] is name-sorted, not recency-sorted. Assert the tool reads
  // last_interaction_at and reduces over all contacts for lastTouchedAt.
  it("reads contact recency from last_interaction_at, never last_contacted_at", () => {
    const contactsAnchor = src.indexOf("contactsSummary");
    assert.ok(contactsAnchor !== -1, "contactsSummary block not found");
    const contactsBlock = src.slice(contactsAnchor, contactsAnchor + 700);
    assert.doesNotMatch(contactsBlock, /last_contacted_at/);
    assert.match(contactsBlock, /last_interaction_at/);
    assert.match(contactsBlock, /\(full\.contacts \|\| \[\]\)\.reduce\(/);
  });
});

// ── The brand deals card (Deals & space on a brand's page) ────────────────
// The list a brand's page draws: the 20 most recent deals the brand is a
// party to. A client login must get exactly the deals the profile already
// gives it (its own company as landlord, vendor or purchaser), and a
// scheme-limited Landsec login only the deals at its own schemes.
const CLIENT_SCOPE = " AND (d.landlord_id = $2 OR d.vendor_id = $2 OR d.purchaser_id = $2)";

describe("brandDealListSql", () => {
  const staffSql = brandDealListSql("");
  const clientSql = brandDealListSql(CLIENT_SCOPE);
  const schemeSql = brandDealListSql(CLIENT_SCOPE, BRAND_DEAL_PROPERTY_SCOPE);

  it("matches the brand as any party, the same WHERE as the profile's other deal queries", () => {
    assert.match(staffSql, /WHERE \(d\.tenant_id = \$1 OR d\.landlord_id = \$1 OR d\.vendor_id = \$1 OR d\.purchaser_id = \$1\)/);
  });

  it("is not the landlord deals board: no bgp_acting_for test, no group walk", () => {
    assert.doesNotMatch(staffSql, /bgp_acting_for|parent_company_id|brand_group_id/);
  });

  it("staff SQL carries no viewer parameter", () => {
    assert.doesNotMatch(staffSql, /\$2|\$3/);
  });

  it("embeds the client-counterparty scope verbatim, inside the WHERE", () => {
    assert.ok(clientSql.includes(`= $1)${CLIENT_SCOPE}\n    ORDER BY`));
  });

  it("adds the scheme property scope after the client scope", () => {
    assert.ok(schemeSql.includes(`${CLIENT_SCOPE}${BRAND_DEAL_PROPERTY_SCOPE}\n    ORDER BY`));
    assert.match(BRAND_DEAL_PROPERTY_SCOPE, /^ AND d\.property_id = ANY\(\$3/);
  });

  it("is capped at the 20 most recent, newest update first", () => {
    assert.equal(BRAND_DEAL_LIST_LIMIT, 20);
    assert.match(staffSql, /ORDER BY d\.updated_at DESC NULLS LAST, d\.id\s+LIMIT 20$/);
  });

  it("counts the full scoped set with window counts, so the totals share the WHERE", () => {
    assert.match(staffSql, /\(COUNT\(\*\) OVER \(\)\)::int AS total/);
    assert.match(staffSql, /COUNT\(\*\) FILTER \(WHERE NOT UPPER\(BTRIM\(COALESCE\(d\.status, ''\)\)\) IN \('WIT', 'COM', 'INV', 'ARCH'\)\) OVER \(\)\)::int AS live/);
    assert.match(staffSql, /IN \('COM', 'INV'\) OR d\.completed_at IS NOT NULL\) OVER \(\)\)::int AS completed/);
  });

  it("selects no fee, fee split or BGP team column", () => {
    const select = staffSql.slice(0, staffSql.indexOf("FROM crm_deals"));
    assert.doesNotMatch(select, /fee|team|internal_agent|allocation|notes|comment/i);
  });
});

describe("brandDealList", () => {
  const raw = [
    { id: "d1", deal_ref: "1042", name: "Unit 4 letting", deal_type: "New Letting", status: "NEG", role: "tenant",
      property_id: "p1", property_name: "Bluewater", unit_name: "Unit 4", updated_at: new Date("2026-11-01T10:00:00Z"),
      total: 31, live: 12, completed: 17,
      // Columns a later edit might add to the SELECT: they must not get out.
      fee: 45000, team: ["London Leasing"], internal_agent: ["Victoria"], fee_agreement: "10% of rent", landlord_id: "L1" },
    { id: "d2", deal_ref: null, name: "Old deal", deal_type: null, status: null, role: "tenant",
      property_id: null, property_name: null, unit_name: null, updated_at: null, total: 31, live: 12, completed: 17 },
  ];
  const list = brandDealList(raw);

  it("sends the named fields and nothing else, for every viewer", () => {
    assert.deepEqual(Object.keys(list.rows[0]).sort(), [
      "deal_ref", "deal_type", "id", "name", "property_id", "property_name", "role", "status", "unit_name", "updated_at",
    ]);
    assert.doesNotMatch(JSON.stringify(list), /45000|London Leasing|Victoria|10% of rent|L1/);
  });

  it("reads the full-set counts from the window columns, not the row count", () => {
    assert.equal(list.rows.length, 2);
    assert.deepEqual({ total: list.total, live: list.live, completed: list.completed }, { total: 31, live: 12, completed: 17 });
  });

  it("gives numbers, ISO dates and nulls a page can draw", () => {
    assert.equal(list.rows[0].deal_ref, 1042);
    assert.equal(list.rows[0].updated_at, "2026-11-01T10:00:00.000Z");
    assert.equal(list.rows[1].deal_ref, null);
    assert.equal(list.rows[1].property_name, null);
  });

  it("is empty with zero counts when nothing is in scope", () => {
    assert.deepEqual(brandDealList([]), { rows: [], total: 0, live: 0, completed: 0 });
  });
});

describe("brand-profile.ts deal list wiring", () => {
  const src = readFileSync(new URL("./brand-profile.ts", import.meta.url), "utf8");
  const at = src.indexOf("const dealListQ = pool.query(");
  const from = src.indexOf("const dealsClientScope = bpScope");
  const block = at === -1 || from === -1 ? "" : src.slice(from, at + 400);

  it("passes the SAME client scope variable the other deal queries use", () => {
    assert.ok(at !== -1, "dealListQ not found");
    assert.match(block, /brandDealListSql\(dealsClientScope, dealListProperties \? BRAND_DEAL_PROPERTY_SCOPE : ""\)/);
    assert.match(src, /const dealsClientScope = bpScope\s+\? ` AND \(d\.landlord_id = \$2 OR d\.vendor_id = \$2 OR d\.purchaser_id = \$2\)`\s+: "";/);
  });

  it("limits a scheme-limited Landsec login to its own schemes, and fails closed", () => {
    assert.match(block, /if \(viewer\?\.schemes\)/);
    assert.match(block, /viewerCanSeeScheme\(viewer, s\.key\)/);
    assert.match(block, /catch \(e: any\) \{[^}]*dealListProperties = \[\];/);
  });

  it("sends the list through the allow-list", () => {
    assert.match(src, /dealList: brandDealList\(dealListRows\.rows\)/);
  });

  // The band's Live deals and Completed, the older deal rows and the deals
  // card must agree: an asset manager read "Live deals 2" over a card that
  // said 1 live, the second being a deal at a scheme not on its login.
  it("gives every deal query on the profile the same scheme limit as the card", () => {
    assert.match(src, /const dealsPropertyScope = dealListProperties \? BRAND_DEAL_PROPERTY_SCOPE : "";/);
    assert.match(src, /const dealsParams = dealListProperties \? \[companyId, bpScope, dealListProperties\] : bpScope \? \[companyId, bpScope\] : \[companyId\];/);
    assert.match(src, /dealTotalsSql\(dealsClientScope, dealsPropertyScope\),\s+dealsParams/);
    // Every statement that takes the client scope takes the scheme limit with it.
    const scoped = src.match(/\$\{dealsClientScope\}(\$\{dealsPropertyScope\})?/g) || [];
    assert.ok(scoped.length >= 2, "the deal queries were not found");
    for (const use of scoped) assert.equal(use, "${dealsClientScope}${dealsPropertyScope}");
    assert.doesNotMatch(src.slice(from), /dealTotalsSql\(dealsClientScope\)/);
  });
});

describe("dealTotalsSql scheme limit", () => {
  it("adds the property scope after the client scope, inside the scoped set", () => {
    const sql = dealTotalsSql(CLIENT_SCOPE, BRAND_DEAL_PROPERTY_SCOPE);
    assert.ok(sql.includes(`= $1)${CLIENT_SCOPE}${BRAND_DEAL_PROPERTY_SCOPE}\n   )`));
  });

  it("is unchanged for staff and for a full client login", () => {
    assert.doesNotMatch(dealTotalsSql(""), /\$2|\$3/);
    assert.doesNotMatch(dealTotalsSql(CLIENT_SCOPE), /\$3/);
  });
});

// The brand page's other deal reads: "In talks at", tenancies by deal,
// offers, viewings, targets and BGP's tracker notes. An asset manager read
// the unit and stage of a deal at a scheme not on its login from here.
describe("brand activity scheme limit (server/crm.ts)", () => {
  const crm = readFileSync(new URL("./crm.ts", import.meta.url), "utf8");
  const access = readFileSync(new URL("./landsec-access.ts", import.meta.url), "utf8");
  const activity = crm.slice(crm.indexOf('app.get("/api/brands/:id/portfolio-activity"'), crm.indexOf('app.get("/api/brands/:id/tracker-comments"'));
  const comments = crm.slice(crm.indexOf('app.get("/api/brands/:id/tracker-comments"'), crm.indexOf('app.get("/api/brands/:id/suggested-pitches"'));

  it("reads the viewer's schemes through landsecViewer, and only a restricted login is limited", () => {
    const fn = access.slice(access.indexOf("export async function schemeLimitedPropertyIds"));
    assert.match(fn, /const viewer = await landsecViewer\(req\);\s+if \(!viewer\?\.schemes\) return null;/);
    assert.match(fn, /portfolio\.schemes\.filter\(s => viewerCanSeeScheme\(viewer, s\.key\)\)\.flatMap\(s => s\.properties\.map\(p => p\.id\)\)/);
  });

  it("fails closed: a failed read gives no properties, never the whole Landsec portfolio", () => {
    const helper = crm.slice(crm.indexOf("const brandActivitySchemeProperties"), crm.indexOf('app.get("/api/brands/:id/portfolio-activity"'));
    assert.match(helper, /return await schemeLimitedPropertyIds\(req\);/);
    assert.match(helper, /catch \(e: any\) \{[^}]*return \[\];/);
  });

  for (const [name, route] of [["portfolio-activity", activity], ["tracker-comments", comments]] as const) {
    it(`${name}: a scheme-limited login's rows come from its own schemes' properties only`, () => {
      assert.match(route, /const schemeProps = scope \? await brandActivitySchemeProperties\(req\) : null;/);
      assert.match(route, /const propScope = \(n: number\) => schemeProps\s+\? `AND p\.id = ANY\(\$\$\{n\}::varchar\[\]\)`\s+: scope/);
      // The limit is the one scope fragment every statement in the route appends.
      assert.doesNotMatch(route.replace(/const propScope[\s\S]*?: "";/, ""), /p\.landlord_id = \$/);
    });
  }

  it("portfolio-activity: every statement takes the scope, the deals among them", () => {
    assert.equal((activity.match(/\$\{propScope\(\d\)\}/g) || []).length, 6);
    assert.match(activity, /const p2 = \(base: any\[\]\) => schemeProps \? \[\.\.\.base, schemeProps\] : scope \? \[\.\.\.base, scope\] : base;/);
    assert.match(activity, /FROM crm_deals d JOIN crm_properties p ON p\.id = d\.property_id[\s\S]*?\$\{propScope\(2\)\}/);
  });

  it("tracker-comments: the parameters carry the property list in the scope's place", () => {
    assert.match(comments, /schemeProps \? \[brandId, brandName, schemeProps\] : scope \? \[brandId, brandName, scope\] : \[brandId, brandName\]/);
  });
});

// What the review of 13 November added to the pack beyond the deal list.
describe("brand pack for any client login (server/brand-pack.ts)", () => {
  const pack = readFileSync(new URL("./brand-pack.ts", import.meta.url), "utf8");
  const route = pack.slice(pack.indexOf('router.get("/api/brand/:companyId/pack.pdf"'));
  const loader = pack.slice(pack.indexOf("async function loadBrandPackData"), pack.indexOf("async function loadHeroImages"));

  it("has no second deal query that is not cut", () => {
    assert.equal((loader.match(/FROM crm_deals/g) || []).length, 1);
  });

  it("refuses a company the client may not see, before anything is loaded", () => {
    const gate = route.indexOf("if (scope && scope !== companyId && !inSlice) return res.status(403)");
    assert.ok(gate !== -1, "the pack's own access check was not found");
    assert.ok(gate < route.indexOf("loadBrandPackData("));
  });

  it("prints the BGP take only where the brand page gives it", () => {
    assert.match(route, /const withTake = !scope \|\| \(inSlice && !viewer\);/);
    assert.match(loader, /if \(withTake\) brief = \(await readPreparedBrandAiTake\(companyId, "brand"\)\)\.text \|\| "";/);
    assert.equal((loader.match(/readPreparedBrandAiTake\(companyId/g) || []).length, 1, "the take is read in one place");
  });

  it("gives a client the saved analysis without BGP's pitch advice, and tenant-rep representation only", () => {
    assert.match(loader, /if \(forClient\) company\.rows\[0\]\.brand_analysis = clientBrandAnalysis\(company\.rows\[0\]\.brand_analysis\);/);
    assert.ok(loader.includes("WHERE r.brand_company_id = $1 AND r.end_date IS NULL${forClient ? ` AND r.agent_type = 'tenant_rep'` : \"\"} LIMIT 4"));
  });
});

// ── A scheme-limited Landsec login and the rest of the brand page ─────────
// The deals were cut to the login's schemes on 13 November; the tenancies,
// lease events, pitched-to list, stores' nearby property and suggested
// pitches were still read portfolio-wide or with no limit at all, so a
// Bluewater-only asset manager read another landlord's property, unit count
// and passing rent. Each of them now takes the same property list as the
// deals, and none of them changes for any other viewer.
describe("brandLiveLocationsSql", () => {
  const open = brandLiveLocationsSql(false);
  const limited = brandLiveLocationsSql(true);

  it("is the statement the profile always ran when there is no scheme limit", () => {
    assert.doesNotMatch(open, /\$2/);
    assert.match(open, /WHERE t\.tenant_company_id = \$1\s+AND \(t\.status IS NULL OR t\.status NOT IN \('Vacant', 'Void'\)\)\s+GROUP BY p\.id\s+ORDER BY units DESC, p\.name$/);
  });

  it("limits a scheme-limited login to its own properties, inside the WHERE", () => {
    assert.match(BRAND_LIVE_LOCATIONS_PROPERTY_SCOPE, /^\s+AND p\.id = ANY\(\$2::varchar\[\]\)$/);
    assert.equal(limited, open.replace("\n        GROUP BY", `${BRAND_LIVE_LOCATIONS_PROPERTY_SCOPE}\n        GROUP BY`));
  });
});

describe("brand-profile.ts scheme limit beyond the deals", () => {
  const src = readFileSync(new URL("./brand-profile.ts", import.meta.url), "utf8");
  const handler = src.slice(src.indexOf('router.get("/api/brand/:companyId/profile"'), src.indexOf("// ─── Update brand-specific fields"));
  const statement = (name: string) => {
    const at = handler.indexOf(`const ${name} = pool.query(`);
    assert.ok(at !== -1, `${name} not found`);
    return handler.slice(at, handler.indexOf("\n    );", at) + 7);
  };

  it("live tenancies: the scheme list is the only extra parameter, and only for that login", () => {
    const q = statement("liveLocationsQ");
    assert.match(q, /brandLiveLocationsSql\(!!dealListProperties\),\s+dealListProperties \? \[companyId, dealListProperties\] : \[companyId\]/);
    // Not dealsParams: this statement has no $2 for the client company.
    assert.doesNotMatch(q, /dealsParams/);
  });

  it("the list is the one the deals use, so a failed read of the schemes sends no tenancies", () => {
    assert.match(handler, /catch \(e: any\) \{[^}]*dealListProperties = \[\];/);
    assert.equal((handler.match(/dealListProperties = /g) || []).length, 2, "the list is worked out in one place only");
  });

  it("pitched to and lease events stop at the login's schemes, after the client's own estate", () => {
    assert.match(BRAND_SCHEME_PROPERTY_SCOPE, /^ AND p\.id = ANY\(\$3::varchar\[\]\)$/);
    assert.match(handler, /const schemePropertyScope = dealListProperties \? BRAND_SCHEME_PROPERTY_SCOPE : "";/);
    for (const [name, scope] of [["pitchedToQ", "pitchedToScope"], ["leaseEventsQ", "leaseEventsScope"]] as const) {
      const q = statement(name);
      assert.ok(q.includes(`\${${scope}}\${schemePropertyScope}`), `${name} does not take the scheme limit`);
      assert.match(q, /,\s+dealsParams\s+\);$/, `${name} must take the deals' parameters ($3 is the scheme list)`);
    }
    // Neither scope fragment is ever appended without the scheme limit.
    assert.equal((handler.match(/\$\{(pitchedToScope|leaseEventsScope)\}(?!\$\{schemePropertyScope\})/g) || []).length, 0);
  });

  it("the landlord's own property list on the profile takes the same limit", () => {
    const q = statement("ownedPropertiesQ");
    assert.match(q, /WHERE p\.landlord_id = \$1\$\{dealListProperties \? " AND p\.id = ANY\(\$2::varchar\[\]\)" : ""\}/);
    assert.match(q, /dealListProperties \? \[companyId, dealListProperties\] : \[companyId\]/);
  });

  it("stores are tagged against the login's own properties only, before the distance loop", () => {
    const filter = handler.indexOf("const ownProperties = dealListProperties ? new Set(dealListProperties) : null;");
    const loop = handler.indexOf("for (const p of properties)");
    assert.ok(filter !== -1 && loop !== -1 && filter < loop);
    assert.match(handler.slice(filter, loop), /Number\.isFinite\(p\.lat\) && Number\.isFinite\(p\.lng\) && \(!ownProperties \|\| ownProperties\.has\(p\.id\)\)/);
  });

  it("the comparable rows and BGP's deal learnings are not sent to that login", () => {
    assert.match(handler, /rentComps: dealListProperties \? \[\] : rentComps\.rows,/);
    const learnings = handler.indexOf('if (dealListProperties) signals.rows = signals.rows.filter((s: any) => !/^bgp-deal:/i.test(String(s.source || "")));');
    assert.ok(learnings !== -1 && learnings < handler.indexOf("const filteredSignals = signals.rows.filter("));
  });

  it("the rent range, sizes and affordability come from comparables at that login's schemes only", () => {
    const q = statement("rentCompsQ");
    assert.ok(q.includes('IS NOT NULL${dealListProperties ? " AND c.property_id = ANY($2::varchar[])" : ""}'), "rentCompsQ does not take the scheme limit");
    assert.match(q, /,\s+dealListProperties \? \[companyId, dealListProperties\] : \[companyId\]\s+\);$/);
    // The limit is in the statement, before LIMIT 20, and both summaries
    // read the rows it returns: neither has a second source of comparables.
    assert.ok(q.indexOf("c.property_id = ANY($2::varchar[])") < q.indexOf("LIMIT 20"));
    assert.match(handler, /computeRentAffordability\(\s+rentComps\.rows,\s+turnover\.rows,\s+!dealListProperties,\s+\)/);
    assert.equal((handler.match(/rentComps\.rows/g) || []).length, 6, "a new reader of the comparables needs the same check");
    // The peer average (every landlord's comparables in the use class) is
    // not worked out for that login.
    assert.match(src, /withPeers = true,/);
    assert.match(src, /if \(topUseClass && withPeers\) \{/);
  });

  it("nothing is limited by the client scope alone: every viewer but that login is untouched", () => {
    // Each new condition hangs off dealListProperties, which is null for
    // staff, a full Landsec login and every other client.
    assert.doesNotMatch(handler, /bpScope \? BRAND_SCHEME_PROPERTY_SCOPE|bpScope \? brandLiveLocationsSql\(true\)/);
    assert.match(handler, /let dealListProperties: string\[\] \| null = null;\s+if \(bpScope\) \{\s+try \{[\s\S]{0,200}if \(viewer\?\.schemes\) \{/);
  });
});

describe("suggested pitches scheme limit (server/crm.ts)", () => {
  const crm = readFileSync(new URL("./crm.ts", import.meta.url), "utf8");
  const route = crm.slice(crm.indexOf('app.get("/api/brands/:id/suggested-pitches"'), crm.indexOf('app.get("/api/available-units/:id/brand-suggestions"'));

  it("a scheme-limited login is offered units at its own schemes only", () => {
    assert.match(route, /const schemeProps = scope \? await brandActivitySchemeProperties\(req\) : null;/);
    assert.match(route, /\$\{schemeProps \? "AND p\.id = ANY\(\$2::varchar\[\]\)" : scope \? "AND \(p\.landlord_id = \$2 OR p\.id IN \(SELECT property_id FROM crm_company_properties WHERE company_id = \$2\)\)" : ""\}/);
    assert.match(route, /schemeProps \? \[brandId, schemeProps\] : scope \? \[brandId, scope\] : \[brandId\]\);/);
  });

  it("the unit read is the only statement in the route that returns a property", () => {
    assert.equal((route.match(/p\.name AS property_name/g) || []).length, 1);
  });
});

describe("the Landsec company's own record for a scheme-limited login", () => {
  const crm = readFileSync(new URL("./crm.ts", import.meta.url), "utf8");
  const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
  const access = readFileSync(new URL("./landsec-access.ts", import.meta.url), "utf8");
  const between = (text: string, from: string, to: string) => text.slice(text.indexOf(from), text.indexOf(to, text.indexOf(from)));

  it("the shared helper fails closed: a failed read gives no properties, never no limit", () => {
    const fn = between(access, "export async function schemeLimitedPropertyIdsOrNone", "// The API a restricted role may reach.");
    assert.match(fn, /return await schemeLimitedPropertyIds\(req\);/);
    assert.match(fn, /catch \(e: any\) \{\s+console\.error\([^\n]*\);\s+return \[\];\s+\}/);
    assert.doesNotMatch(fn, /return null/);
  });

  it("company deals and properties are cut to the schemes, a deal with no property included", () => {
    const deals = between(crm, 'app.get("/api/crm/companies/:id/deals"', 'app.post("/api/crm/companies/:id/deals"');
    assert.match(deals, /const cdSchemeProps = cdScope \? await brandActivitySchemeProperties\(req\) : null;/);
    // Through the one strip (every fee term and BGP's AML working), not the fee and its notes alone.
    assert.match(deals, /if \(cdSchemeProps\) return res\.json\(deals\.filter\(\(d: any\) => d\.propertyId && cdSchemeProps\.includes\(d\.propertyId\)\)\.map\(\(d: any\) => stripDealFees\(d\)\)\);/);
    assert.match(deals, /if \(cdScope\) return res\.json\(deals\.map\(\(d: any\) => stripDealFees\(d\)\)\);/);
    assert.doesNotMatch(deals, /fee: null, feeNotes: null/, "a deal is blanked by hand again");
    const props = between(crm, 'app.get("/api/crm/companies/:id/properties"', 'app.post("/api/crm/companies/:id/properties"');
    assert.match(props, /const cpSchemeProps = cpScope \? await brandActivitySchemeProperties\(req\) : null;/);
    assert.match(props, /if \(cpSchemeProps\) return res\.json\(properties\.filter\(\(p: any\) => cpSchemeProps\.includes\(p\.id\)\)\);/);
  });

  it("property-summary keeps only the scheme properties, for either role", () => {
    const route = between(routes, 'app.get("/api/crm/companies/:companyId/property-summary"', 'app.get("/api/crm/companies/:companyId/contact-summary"');
    assert.match(route, /const schemeProps = await schemeLimitedPropertyIdsOrNone\(req, "property-summary"\);\s+if \(schemeProps\) rows = rows\.filter\(\(r: any\) => schemeProps\.includes\(r\.id\)\);/);
    // After both role branches, immediately before the reply.
    assert.ok(route.indexOf("schemeLimitedPropertyIdsOrNone") > route.indexOf('if (scopeCompanyId && role === "tenant")'));
  });

  it("contact-summary reads brands and agents from the deals at the schemes only", () => {
    const route = between(routes, 'app.get("/api/crm/companies/:companyId/contact-summary"', 'app.get("/api/company-portfolio/:companyId"');
    assert.match(route, /const pdealsScheme = schemeProps \? " AND d\.property_id = ANY\(\$2::varchar\[\]\)" : "";/);
    assert.match(route, /const pdealsParams = schemeProps \? \[companyId, schemeProps\] : \[companyId\];/);
    assert.equal((route.match(/company_id = \$1\)\)\$\{pdealsScheme\}/g) || []).length, 2, "both deal sets take the limit");
    assert.equal((route.match(/pdealsParams\s+\);/g) || []).length, 2);
  });

  it("the hub's deal count and the hunter board follow the same list", () => {
    const hub = between(crm, 'app.get("/api/brands/hub"', 'app.get("/api/brands/hunter"');
    assert.match(hub, /const hubSchemeProps = hubScope \? await brandActivitySchemeProperties\(req\) : null;/);
    // Any client login counts its own deals with the brand (it counted the
    // brand's deals with every landlord); the scheme list narrows that.
    assert.ok(hub.includes("const hotDealJoin = `(d.tenant_id = c.id) AND d.updated_at > NOW() - INTERVAL '90 days'`"));
    assert.ok(hub.includes("+ (clientScoped ? ` AND (d.landlord_id = $1 OR d.vendor_id = $1 OR d.purchaser_id = $1)` : \"\")"));
    assert.ok(hub.includes("+ (hubSchemeProps ? ` AND d.property_id = ANY($2::varchar[])` : \"\");"));
    assert.match(hub, /const hotDealParams: any\[\] = clientScoped \? \(hubSchemeProps \? \[hubScope, hubSchemeProps\] : \[hubScope\]\) : \[\];/);
    assert.ok(hub.includes("LEFT JOIN crm_deals d ON ${hotDealJoin}\n"));
    assert.match(hub, /`, hotDealParams\)\.then\(r => r\.rows\);/);
    const hunter = crm.slice(crm.indexOf('app.get("/api/brands/hunter"'), crm.indexOf('app.get("/api/brands/hunter"') + 12000);
    assert.match(hunter, /const hunterSchemeLimited = hunterClientScoped && !!\(await brandActivitySchemeProperties\(req\)\);/);
    assert.match(hunter, /if \(hunterSchemeLimited\) \{[\s\S]{0,200}b\.brand_analysis = undefined;/);
    assert.match(hunter, /if \(hunterSchemeLimited\) b\.expansionFlags = b\.expansionFlags\.filter\(\(f: string\) => schemeLimitedScoreLabel\(f\)\);/);
  });
});

// The Brand pack button on the page header: the PDF listed six of the
// brand's deals with any landlord, with rent, size and term, and printed the
// BGP take the page withholds from this login.
describe("brand pack for a scheme-limited login (server/brand-pack.ts)", () => {
  const src = readFileSync(new URL("./brand-pack.ts", import.meta.url), "utf8");
  const loader = src.slice(src.indexOf("async function loadBrandPackData"), src.indexOf("async function loadHeroImages"));
  const route = src.slice(src.indexOf('router.get("/api/brand/:companyId/pack.pdf"'));

  it("the route works out the schemes, fails closed and takes the brand page's gate", () => {
    assert.match(route, /const schemeProps = await schemeLimitedPropertyIdsOrNone\(req, "brand-pack"\);/);
    // The company check is made for every client login, before the schemes are read.
    assert.match(route, /const inSlice = scope \? await isClientVisibleBrand\(companyId, scope\) : false;\s+if \(scope && scope !== companyId && !inSlice\) return res\.status\(403\)/);
    assert.ok(route.indexOf("if (scope && scope !== companyId && !inSlice) return res.status(403)") < route.indexOf("schemeLimitedPropertyIdsOrNone"));
    assert.match(route, /if \(schemeProps\) viewer = \{ scope, schemeProps \};/);
    assert.match(route, /loadBrandPackData\(companyId, !!scope, viewer, scope \|\| null, withTake\)/);
  });

  it("its deals are Landsec's own, at its schemes; staff's statement has one parameter", () => {
    assert.ok(loader.includes(`WHERE (d.tenant_id = $1 OR d.landlord_id = $1 OR d.vendor_id = $1 OR d.purchaser_id = $1)\${viewer ? " AND (d.landlord_id = $2 OR d.vendor_id = $2 OR d.purchaser_id = $2) AND d.property_id = ANY($3::varchar[])" : forClient ? " AND (d.landlord_id = $2 OR d.vendor_id = $2 OR d.purchaser_id = $2)" : ""}`));
    assert.match(loader, /viewer \? \[companyId, viewer\.scope, viewer\.schemeProps\] : forClient \? \[companyId, clientScope\] : \[companyId\]/);
  });

  // Any client login: the pack printed six of the brand's deals with every
  // landlord, with rent, size and term (another landlord's client read
  // Landsec's rents). It follows the Deals card's counterparty rule.
  it("a client's pack lists only the deals its own company is party to, and none when the company is unknown", async () => {
    const ts = (await import("typescript")).default;
    const js = ts.transpileModule(loader, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const run = async (...args: any[]) => {
      const seen: { sql: string; params: any[] }[] = [];
      const pool = { query: async (sql: string, params: any[]) => {
        if (sql.includes("FROM crm_deals")) seen.push({ sql, params });
        if (sql.includes("FROM crm_companies WHERE")) return { rows: [{ id: "brand", name: "Brand" }] };
        return { rows: [] };
      } };
      const stub = () => "TRUE";
      const mod: any = {};
      new Function("exports", "require", "pool", "isBrandSignalRelevant", "rankCompanyHeroImages", "publishableBrandImage",
        "requirementReason", "requirementStateSql", "requirementClientVisibleSql", "requirementLiveColumnsSql", "clientBrandAnalysis",
        `${js}\nexports.load = loadBrandPackData;`)(mod, () => ({ readPreparedBrandAiTake: async () => ({ text: "" }) }), pool,
        () => true, () => [], () => true, () => ({ text: "", clientText: "" }), stub, stub, () => "r.status", (text: any) => text);
      await mod.load(...args).catch(() => null);
      assert.equal(seen.length, 1, "one deals statement");
      return seen[0];
    };
    const counterparty = " AND (d.landlord_id = $2 OR d.vendor_id = $2 OR d.purchaser_id = $2)";
    const staff = await run("brand");
    assert.ok(!staff.sql.includes("$2"));
    assert.deepEqual(staff.params, ["brand"]);
    const client = await run("brand", true, null, "landlord-co");
    assert.ok(client.sql.includes(`${counterparty}\n`), "the counterparty rule, with no scheme limit");
    assert.deepEqual(client.params, ["brand", "landlord-co"]);
    // No company: $2 is NULL, which matches no deal.
    const unknown = await run("brand", true);
    assert.ok(unknown.sql.includes(counterparty));
    assert.deepEqual(unknown.params, ["brand", null]);
    const limited = await run("brand", true, { scope: "landlord-co", schemeProps: ["p1"] }, "landlord-co");
    assert.ok(limited.sql.includes(`${counterparty} AND d.property_id = ANY($3::varchar[])`));
    assert.deepEqual(limited.params, ["brand", "landlord-co", ["p1"]]);
  });

  it("no BGP take, saved analysis or deal learning is printed for it", () => {
    assert.match(loader, /if \(viewer\) \{[^}]*company\.rows\[0\]\.brand_analysis = null;\s+\} else \{\s+try \{\s+const \{ readPreparedBrandAiTake \}/);
    assert.match(loader, /if \(viewer && \/\^bgp-deal:\/i\.test\(String\(s\.source \|\| ""\)\)\) continue;/);
    // The take section is drawn only from the brief or the saved analysis.
    assert.match(route, /const analysis = briefLines\.length \? "" : trimAtSentence\(company\.brand_analysis, 650\);\s+if \(\(briefLines\.length \|\| analysis\)/);
  });
});

describe("suggested units and the expansion score for a scheme-limited login", () => {
  const take = readFileSync(new URL("./brand-ai-take.ts", import.meta.url), "utf8");
  const intel = readFileSync(new URL("./expansion-intel.ts", import.meta.url), "utf8");

  it("suggested-units is refused to every client login, a scheme-limited one included, before any query", () => {
    // Units, rents and target lists at every landlord's schemes: BGP staff only.
    const route = take.slice(take.indexOf('router.get("/api/brand/:companyId/suggested-units"'));
    const gate = route.search(/if \(\(await resolveCompanyScope\(req\)\) \|\| \(await isClientRequestUser\(req\)\)\) return res\.status\(403\)/);
    assert.ok(gate !== -1 && gate < route.indexOf("pool.query"));
  });

  it("both score routes drop BGP's cross-landlord counts for that login only", () => {
    assert.match(take, /const schemeLimited = shown !== result && !!\(await schemeLimitedPropertyIdsOrNone\(req, "hunter-score"\)\);\s+res\.json\(schemeLimited \? schemeLimitedScoreView\(shown\) : shown\);/);
    assert.match(intel, /const schemeLimited = shown !== result && !!\(await schemeLimitedPropertyIdsOrNone\(req, "expansion-score"\)\);/);
  });

  const result = {
    score: 61, subScores: { ukMomentum: 20, capacity: 10, intent: 11, engagement: 20 },
    lines: [
      { points: 16, bucket: "engagement", label: "2 deals at HoTs or beyond with BGP" },
      { points: 6, bucket: "engagement", label: "1 live deal in negotiation with BGP" },
      { points: 3, bucket: "engagement", label: "1 deal completed with BGP in 2 years" },
      { points: 5, bucket: "engagement", label: "1 offer in 90 days" },
      { points: 6, bucket: "engagement", label: "2 viewings in 90 days" },
      { points: 4, bucket: "engagement", label: "7 touchpoints in 90 days" },
      { points: 6, bucket: "intent", label: "Interest in 2 BGP units in 90 days" },
      { points: 8, bucket: "intent", label: "2 market listings (PIPnet / The Requirement List), not confirmed by BGP" },
      { points: 8, bucket: "intent", label: "1 requirement on BGP's books, confirmed or logged by BGP in 12 months" },
      { points: 12, bucket: "ukMomentum", label: "4 UK openings in 12 months" },
      { points: 8, bucket: "capacity", label: "Covenant grade A" },
    ],
    expansionFlags: ["2 deals at HoTs or beyond with BGP", "12 deals at HoTs or beyond with B…", "4 UK openings in 12 months", "2 viewings in 90 days", "Interest in 2 BGP units in 90 da…", "Covenant grade A"],
  };

  it("a scheme-limited view has no line or flag that counts deals, offers, viewings or enquiries", () => {
    const shown = schemeLimitedScoreView(clientScoreView(result));
    assert.deepEqual(shown.lines.map((l: any) => l.label), ["2 market listings", "4 UK openings in 12 months", "Covenant grade A"]);
    assert.deepEqual(shown.expansionFlags, ["4 UK openings in 12 months", "Covenant grade A"]);
    assert.doesNotMatch(JSON.stringify([shown.lines, shown.expansionFlags]), /deal|offer|viewing|touchpoint|BGP unit/i);
  });

  it("the score and sub-scores are left as they are", () => {
    const shown = schemeLimitedScoreView(clientScoreView(result));
    assert.equal(shown.score, 61);
    assert.deepEqual(shown.subScores, result.subScores);
  });

  it("the plain client view and the staff result are not changed by it", () => {
    const client = clientScoreView(result);
    assert.equal(client.lines.length, 10);
    assert.ok(client.lines.some((l: any) => l.label === "2 deals at HoTs or beyond with BGP"));
    assert.equal(client.expansionFlags.length, 6);
    assert.equal(result.lines.length, 11);
  });

  it("a flag about anything else is kept", () => {
    for (const label of ["Funding: raises £100m", "Tenant rep acting for them", "Stock momentum", "3 UK openings in 12 months", "Stated requirement: 20 sites by 2027"]) {
      assert.equal(schemeLimitedScoreLabel(label), label);
    }
    assert.equal(schemeLimitedScoreLabel(null), null);
  });
});

// The statement itself, run on a real PostgreSQL in a disposable schema.
// Skipped unless BRAND_DEALS_TEST_DATABASE_URL names a database to use:
//   BRAND_DEALS_TEST_DATABASE_URL=postgresql://... node --import tsx --test server/brand-profile-deals.test.ts
describe("brand deal list on PostgreSQL", { skip: !process.env.BRAND_DEALS_TEST_DATABASE_URL }, () => {
  const schema = `qa_brand_deals_${process.pid}_${Date.now()}`;
  let db: pg.Pool;
  const BRAND = "brand", SISTER = "sister", LANDSEC = "landsec", RIVAL = "rival";
  const run = async (viewer: { client?: string; properties?: string[] }) => {
    const text = brandDealListSql(viewer.client ? CLIENT_SCOPE : "", viewer.properties ? BRAND_DEAL_PROPERTY_SCOPE : "");
    const values = viewer.properties ? [BRAND, viewer.client, viewer.properties] : viewer.client ? [BRAND, viewer.client] : [BRAND];
    return brandDealList((await db.query(text, values)).rows);
  };

  before(async () => {
    db = new pg.Pool({ connectionString: process.env.BRAND_DEALS_TEST_DATABASE_URL, ssl: false, options: `-c search_path=${schema}`, max: 1 });
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`
      CREATE TABLE crm_deals(id varchar PRIMARY KEY, deal_ref integer, name text, deal_type text, status text, fee real,
        team text[], internal_agent text[], property_id varchar, unit_id varchar, tenancy_unit_id varchar,
        tenant_id varchar, landlord_id varchar, vendor_id varchar, purchaser_id varchar,
        completed_at timestamp, updated_at timestamp);
      CREATE TABLE crm_properties(id varchar PRIMARY KEY, name text);
      CREATE TABLE property_units(id varchar PRIMARY KEY, unit_name text);
      CREATE TABLE tenancy_schedule_units(id varchar PRIMARY KEY, unit_number text, premises text);
      INSERT INTO crm_properties VALUES ('bluewater','Bluewater'),('trinity','Trinity Leeds'),('rivalmall','Rival Mall');
      INSERT INTO property_units VALUES ('u4','Unit 4');
      INSERT INTO tenancy_schedule_units VALUES ('t9','SU9',NULL),('t7',NULL,'Kiosk 7');
      INSERT INTO crm_deals(id,deal_ref,name,deal_type,status,fee,team,property_id,unit_id,tenancy_unit_id,tenant_id,landlord_id,vendor_id,purchaser_id,completed_at,updated_at) VALUES
        -- An ordinary letting: BGP acts for the landlord, the brand is only the tenant.
        ('landsec-bluewater',101,'Bluewater Unit 4','New Letting','NEG',45000,'{London Leasing}','bluewater','u4',NULL,'${BRAND}','${LANDSEC}',NULL,NULL,NULL,'2026-11-10'),
        ('landsec-trinity',102,'Trinity SU9','New Letting','COM',30000,NULL,'trinity',NULL,'t9','${BRAND}','${LANDSEC}',NULL,NULL,'2026-09-01','2026-09-02'),
        -- The brand's deal with a rival landlord: BGP intel, never a client's to see.
        ('rival-letting',103,'Rival Mall Kiosk 7','New Letting','HOT',20000,NULL,'rivalmall',NULL,'t7','${BRAND}','${RIVAL}',NULL,NULL,NULL,'2026-11-11'),
        -- Tenant-side work with no landlord company on the deal.
        ('tenant-rep',104,'Acquisition search','Lease Disposal','WIT',NULL,NULL,NULL,NULL,NULL,'${BRAND}',NULL,NULL,NULL,NULL,'2026-08-01'),
        -- The brand selling to the client.
        ('sale-to-landsec',105,'Freehold sale','Sale','SOL',NULL,NULL,'bluewater',NULL,NULL,NULL,NULL,'${BRAND}','${LANDSEC}',NULL,'2026-10-01'),
        -- A sister brand's deal with the same client: not this brand's.
        ('sister-deal',106,'Sister at Bluewater','New Letting','NEG',NULL,NULL,'bluewater',NULL,NULL,'${SISTER}','${LANDSEC}',NULL,NULL,NULL,'2026-11-12');`);
  });
  after(async () => {
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined);
    await db.end();
  });

  it("staff see every deal the brand is a party to, newest first, never a sister brand's", async () => {
    const list = await run({});
    assert.deepEqual(list.rows.map(r => r.id), ["rival-letting", "landsec-bluewater", "sale-to-landsec", "landsec-trinity", "tenant-rep"]);
    assert.deepEqual({ total: list.total, live: list.live, completed: list.completed }, { total: 5, live: 3, completed: 1 });
  });

  it("includes the ordinary letting where the brand is only the tenant, with role, property and unit", async () => {
    const row = (await run({})).rows.find(r => r.id === "landsec-bluewater")!;
    assert.deepEqual(row, { id: "landsec-bluewater", deal_ref: 101, name: "Bluewater Unit 4", deal_type: "New Letting", status: "NEG",
      role: "tenant", property_id: "bluewater", property_name: "Bluewater", unit_name: "Unit 4", updated_at: new Date("2026-11-10").toISOString() });
  });

  it("names the unit from the tenancy schedule when the deal has no property unit", async () => {
    const rows = (await run({})).rows;
    assert.equal(rows.find(r => r.id === "landsec-trinity")!.unit_name, "SU9");
    assert.equal(rows.find(r => r.id === "rival-letting")!.unit_name, "Kiosk 7");
    assert.equal(rows.find(r => r.id === "sale-to-landsec")!.role, "vendor");
  });

  it("a client login gets only the deals where its own company is the counterparty", async () => {
    const list = await run({ client: LANDSEC });
    assert.deepEqual(list.rows.map(r => r.id), ["landsec-bluewater", "sale-to-landsec", "landsec-trinity"]);
    assert.doesNotMatch(JSON.stringify(list), /Rival Mall|Kiosk 7|Acquisition search|Sister/);
  });

  it("a client's counts cover its own deals only, so the rival deal cannot be inferred", async () => {
    const list = await run({ client: LANDSEC });
    assert.deepEqual({ total: list.total, live: list.live, completed: list.completed }, { total: 3, live: 2, completed: 1 });
  });

  it("another client sees none of the first client's deals", async () => {
    const list = await run({ client: RIVAL });
    assert.deepEqual(list.rows.map(r => r.id), ["rival-letting"]);
    assert.equal(list.total, 1);
  });

  it("a scheme-limited Landsec login gets the deals at its own schemes only", async () => {
    const list = await run({ client: LANDSEC, properties: ["trinity"] });
    assert.deepEqual(list.rows.map(r => r.id), ["landsec-trinity"]);
    assert.deepEqual({ total: list.total, live: list.live, completed: list.completed }, { total: 1, live: 0, completed: 1 });
  });

  it("a scheme-limited login with no schemes gets nothing", async () => {
    assert.deepEqual(await run({ client: LANDSEC, properties: [] }), { rows: [], total: 0, live: 0, completed: 0 });
  });

  it("no fee or team reaches any viewer", async () => {
    for (const viewer of [{}, { client: LANDSEC }]) {
      assert.doesNotMatch(JSON.stringify(await run(viewer)), /45000|30000|20000|London Leasing/);
    }
  });

  it("caps the rows at 20 while the total stays the full count", async () => {
    await db.query(`INSERT INTO crm_deals(id,name,status,tenant_id,landlord_id,updated_at)
      SELECT 'bulk-' || n, 'Bulk ' || n, 'LIVE', '${BRAND}', '${LANDSEC}', timestamp '2025-01-01' + n * interval '1 day' FROM generate_series(1, 30) n`);
    const staff = await run({});
    assert.equal(staff.rows.length, 20);
    assert.equal(staff.total, 35);
    const client = await run({ client: LANDSEC });
    assert.equal(client.rows.length, 20);
    assert.equal(client.total, 33);
  });
});

// The live tenancies statement, run on a real PostgreSQL in a disposable
// schema (the same switch as the deal list above).
describe("brand live tenancies on PostgreSQL", { skip: !process.env.BRAND_DEALS_TEST_DATABASE_URL }, () => {
  const schema = `qa_brand_tenancies_${process.pid}_${Date.now()}`;
  let db: pg.Pool;
  const BRAND = "brand";
  const run = async (properties?: string[]) =>
    (await db.query(brandLiveLocationsSql(!!properties), properties ? [BRAND, properties] : [BRAND])).rows;

  before(async () => {
    db = new pg.Pool({ connectionString: process.env.BRAND_DEALS_TEST_DATABASE_URL, ssl: false, options: `-c search_path=${schema}`, max: 1 });
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`
      CREATE TABLE crm_properties(id varchar PRIMARY KEY, name text, address jsonb, postcode text, latitude text, longitude text);
      CREATE TABLE tenancy_schedule_units(id varchar PRIMARY KEY, property_id varchar, tenant_company_id varchar, status text,
        passing_rent_pa numeric, lease_expiry date);
      INSERT INTO crm_properties VALUES
        ('bluewater','Bluewater',NULL,'DA9 9ST','51.44','0.27'),
        ('trinity','Trinity Leeds',NULL,'LS1 5AT','',''),
        ('rivalmall','Rival Mall',NULL,'NW4 3FP','51.57','-0.22');
      INSERT INTO tenancy_schedule_units VALUES
        ('t1','bluewater','${BRAND}','Occupied',120000,'2031-06-24'),
        ('t2','bluewater','${BRAND}',NULL,80000,'2029-03-25'),
        ('t3','trinity','${BRAND}','Occupied',95000,'2030-09-29'),
        -- The brand's tenancy at another landlord's scheme, with its rent.
        ('t4','rivalmall','${BRAND}','Occupied',185000,'2027-12-25'),
        -- A void row and another brand's row never count.
        ('t5','rivalmall','${BRAND}','Void',50000,NULL),
        ('t6','bluewater','sister','Occupied',70000,'2028-01-01');`);
  });
  after(async () => {
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined);
    await db.end();
  });

  it("with no scheme limit: every property the brand is a tenant at, as before", async () => {
    const rows = await run();
    assert.deepEqual(rows.map(r => [r.id, Number(r.units), Number(r.total_rent_pa)]), [["bluewater", 2, 200000], ["rivalmall", 1, 185000], ["trinity", 1, 95000]]);
  });

  it("a scheme-limited login gets the tenancies at its own schemes only", async () => {
    const rows = await run(["bluewater"]);
    assert.deepEqual(rows.map(r => r.id), ["bluewater"]);
    assert.equal(Number(rows[0].total_rent_pa), 200000);
    assert.doesNotMatch(JSON.stringify(rows), /Rival Mall|185000|2027|Trinity/);
  });

  it("two schemes on the login give two rows, never the rival landlord's", async () => {
    assert.deepEqual((await run(["trinity", "bluewater"])).map(r => r.id), ["bluewater", "trinity"]);
  });

  it("fails closed: a login whose schemes could not be read gets no tenancies", async () => {
    assert.deepEqual(await run([]), []);
  });

  it("a property outside the brand's tenancies on the login adds nothing", async () => {
    assert.deepEqual(await run(["somewhere-else"]), []);
  });
});
