import assert from 'node:assert/strict';
import test from 'node:test';
import { planTier, rankPlanCandidates, findPropertyFiles } from '../../server/sharepoint-property-files.ts';

// The routes module opens the pool on import; nothing here queries it.
process.env.DATABASE_URL ||= 'postgres://t:t@127.0.0.1:1/t';
const {
  planPageLines, planLevelName, classifyPlanPage, brochurePlanName, brochurePageRef, brochurePagesToImport,
} = await import('../../server/property-plan-sources.ts');

// Pages of The Royal Exchange's two brochures and its GA drawings as pdf.js
// reads them (text lines + vector path data), 2026-09.
const L = (...lines) => lines.join('\n');
const REX = {
  leasingFloorPlan: { pathData: 99_038, text: L('R E : I M A G I N E   Y O U R   R E : T A I L', '2 0 ', 'F L O O R   P L A N ', '2 1 ', 'Grind & Co', 'Cafe', 'Jo Malone ', 'THREADNEEDLE STREET', 'CORNHILL', 'BANK ', 'Hermès ', 'Montblanc', 'Management ', 'Suite ', 'Office ', 'Entrance ', '7', '29', 'Under   Offer') },
  leasingProse: { pathData: 69, text: L('R E : I M A G I N E   Y O U R   R E : T A I L', '2 ', 'A N   I C O N I C   I D E N T I T Y   W I T H   A   N E W   O U T L O O K ', 'An Iconic Home', 'for the most', 'Esteemed', 'Luxury Brands ', 'Smart, stylish, historic and high-end. Given its royal title', 'in 1571 by Elizabeth I, today the iconic classical building has', 'been reborn as The City’s premiere destination for luxury. ') },
  leasingDisclaimer: { pathData: 4_921, text: 'Bruce Gillingham Pollard and Savills, on their behalf and for the Vendors or Lessors of this property whose Agents’ they are, give notice that: 1.   These particulars are set\nout as a general outline only for guidance to intending Purchasers or Lessees' },
  investmentRetailPlan: { pathData: 136_954, text: L('CORNHILL', 'THREADNEEDLE STREET ', 'MANAGEMENT', 'SUITE ', 'Oeno House ', 'Jang ', 'Hagen', 'Salad Kitchen ', 'This iconic building offers exceptional food and drink', 'options on site and with an unparalleled list of retailers,', 'The retail and restaurants located in the ground ', 'and mezzanine floors of The Royal Exchange ', 'are under separate ownership. T H E   R O Y A L   E X C H A N G E ', '0 3 ') },
  investmentLocationMap: { pathData: 2_690, text: L('BLOOMBERG HQ', 'BANK OF ENGLAND', 'TOWER 42', 'MANSION HOUSE', 'LEADENHALL MARKET', 'LIVERPOOL STREET', 'CANNON STREET T H E   R O Y A L   E X C H A N G E ', '0 4 ') },
  investmentDescription: { pathData: 244, text: L('DESCRIPTION ', 'Royal Exchange is recognised as being the most', 'architecturally important building in London after', 'The upper floors of Royal Exchange comprise ', 'the office element which totals approximately ', '6321.1 sq m (68,040 sq ft). The building was ', 'Newly refurbished 1st floor CAT B offices and', 'mezzanine bike storage and showers completed.', 'Second floor CAT A refurbishment planned for 2026.', '3rd and 4th floors recently refurbished to CAT B ') },
  investmentAreaTable: { pathData: 263, text: L('ACCOMMODATION ', 'Royal Exchange provides the', 'following net internal floor areas: ', 'Floor   Use   Area', 'sq ft', 'Area', 'sq m', 'Fourth   Office   15,270   1,418.2', 'Third   Office   15,407   1,430.9', 'Second   Office   15,552   1,444.4', 'First   Office   18,986   1,763.9 ', 'Mezzanine   Office   2,580   239.7 ', 'Basement   Storage   245   22.8', 'Total   68,040   6321.1 ', 'Recently refurbished 4th floor T H E   R O Y A L   E X C H A N G E ') },
  investmentOfficePlans: { pathData: 245_652, text: L('Not to scale. Indicative only. ', 'FIRST FLOOR ', '18,986 sq ft (1,763.9 sq m) ', 'THIRD FLOOR ', '15,407 sq ft (1,430.9 sq m) ', 'FOURTH FLOOR ', '15,270 sq ft (1,418.2 sq m) ', 'SECOND FLOOR ', '1 5,552 sq ft (1,444.4 sq m) ', 'M&E', 'M&E T H E   R O Y A L   E X C H A N G E ', '0 8 ') },
  investmentSitePlan: { pathData: 18_249, text: L('Pp', 'LB', 'D Fn Trough ', 'PH', '15 to 22 ', '28 to 30', '62 to 63', '36 to 38 ', '33 to 35', '1 to 6', 'BANK OF ENGLAND', 'ROYAL', 'EXCHANGE', 'CORNHILL', 'FINCH LANE', 'POPE’S HEAD ALLEY', 'THREADNEEDLE STREET', 'BARTHOLOMEW LANE') },
  investmentCover: { pathData: 1_909, text: '' },
  gaBasement: { pathData: 339_723, text: L('SHARED PLANTROOM ', 'STAFF CHANGING ROOM', 'UNIT 33   UNIT 31', 'UNIT 30   UNIT 29a   UNIT 29', 'UNIT 28   UNIT 27   UNIT 26   UNIT 25   UNIT 24', 'UNIT 23', 'UNIT 22', 'UNIT 21', 'UNIT 20', 'UNIT 19', 'The Royal Exchange / Oxford Properties ', 'The Royal Exchange', 'Existing Basement Plan', '13/12/17   DP   NL   DS ', 'FOR INFORMATION ', '21668-01-099 ', ...Array(120).fill('FFL SSL +11.96 STORAGE REFUSE STORE')) },
  gaMezzanine: { pathData: 399_818, text: L('THREADNEEDLE MEZZANINE', 'CORNHILL MEZZANINE ', 'FORTNUM &', 'MASON', 'KITCHEN ', 'UNIT 33', 'UNIT 31', 'UNIT 30   UNIT 29a   UNIT 29', 'UNIT 28   UNIT 27   UNIT 26', 'The Royal Exchange', 'Existing Mezzanine Floor Plan', 'FOR INFORMATION ', '21668-01-101 ') },
};

test('brochure letter-spacing closes up so titles read as words', () => {
  assert.deepEqual(planPageLines('F L O O R   P L A N \n2 0 \nUNIT 33   UNIT 31'), ['FLOOR PLAN', '20', 'UNIT 33 UNIT 31']);
  assert.deepEqual(planPageLines('Do   not   scale   from   the   drawing.'), ['Do not scale from the drawing.']);
});

test('Royal Exchange brochures: the floor plan, retail plan, office plans and site plan are found; prose, maps and tables are not', () => {
  const plans = ['leasingFloorPlan', 'investmentRetailPlan', 'investmentOfficePlans', 'investmentSitePlan', 'gaBasement', 'gaMezzanine'];
  const notPlans = ['leasingProse', 'leasingDisclaimer', 'investmentLocationMap', 'investmentDescription', 'investmentAreaTable', 'investmentCover'];
  for (const key of plans) assert.equal(classifyPlanPage(REX[key]).isPlan, true, `${key} should read as a plan: ${JSON.stringify(classifyPlanPage(REX[key]))}`);
  for (const key of notPlans) assert.equal(classifyPlanPage(REX[key]).isPlan, false, `${key} is not a plan: ${JSON.stringify(classifyPlanPage(REX[key]))}`);
});

test('plan pages are named from their floor titles, a map extract is a site plan', () => {
  assert.equal(classifyPlanPage(REX.investmentOfficePlans).name, 'First, Second, Third & Fourth Floors');
  assert.equal(classifyPlanPage(REX.gaBasement).name, 'Basement');
  assert.equal(classifyPlanPage(REX.gaMezzanine).name, 'Mezzanine Floor');
  assert.equal(classifyPlanPage(REX.leasingFloorPlan).name, null, 'a plan without a floor title leaves the name to the fallback');
  assert.equal(classifyPlanPage(REX.leasingFloorPlan).kind, 'floor');
  assert.equal(classifyPlanPage(REX.investmentSitePlan).kind, 'site');
  // Prose that mentions floors names nothing.
  assert.equal(planLevelName(planPageLines('The retail and restaurants located in the ground and mezzanine floors')), null);
  assert.equal(planLevelName(['GROUND FLOOR', 'LOWER GROUND FLOOR']), 'Lower Ground & Ground Floors');
  assert.equal(planLevelName(['Lower Level', 'Upper Mall']), 'Lower Level / Upper Mall');
  assert.equal(planLevelName(['LEVEL 2']), 'Level 2');
  assert.equal(planLevelName(['3rd floor']), 'Third Floor');
});

test('an agent brochure plan page with a raster drawing still qualifies on its title, floor and areas', () => {
  const page = { pathData: 120, text: L('Floor Plans', 'Ground Floor', '1,250 sq ft (116.1 sq m)', 'For identification purposes only') };
  const verdict = classifyPlanPage(page);
  assert.equal(verdict.isPlan, true);
  assert.equal(verdict.name, 'Ground Floor');
});

test('a tenancy schedule page with unit rows and some linework is not a plan', () => {
  const rows = Array.from({ length: 12 }, (_, i) => `Unit ${i + 1}   Tenant ${i}   £${(i + 1) * 10},000 per annum   Lease expiry 2030   Break 2028`);
  assert.equal(classifyPlanPage({ pathData: 6_000, text: L('TENANCY SCHEDULE', ...rows) }).isPlan, false);
});

test('fallback floor names: floors, else Floor plan / Site plan, with the page added when the name is taken', () => {
  const taken = new Set(['ground floor']);
  assert.equal(brochurePlanName({ name: null, kind: 'floor' }, 11, taken), 'Floor plan');
  assert.equal(brochurePlanName({ name: null, kind: 'floor' }, 12, taken), 'Floor plan · p12');
  assert.equal(brochurePlanName({ name: 'Ground Floor', kind: 'floor' }, 4, taken), 'Ground Floor · p4');
  assert.equal(brochurePlanName({ name: null, kind: 'site' }, 10, taken), 'Site plan');
  assert.equal(brochurePlanName(undefined, 3, taken), 'Floor plan · p3');
});

test('running the brochure import twice adds nothing: imported pages are skipped', () => {
  const id = '1226fe2c-f77d-40e4-b77f-8b351764b432';
  assert.equal(brochurePageRef(id, 11), `brochure:${id}:p11`);
  assert.deepEqual(brochurePagesToImport([11, 4, 11], 14, id, new Set()), { pages: [4, 11], skipped: [] });
  assert.deepEqual(brochurePagesToImport([11, 4], 14, id, new Set([brochurePageRef(id, 11)])), { pages: [4], skipped: [11] });
  assert.deepEqual(brochurePagesToImport([11], 14, id, new Set([brochurePageRef(id, 11)])), { pages: [], skipped: [11] });
  assert.throws(() => brochurePagesToImport([15], 14, id, new Set()), /aren't in this brochure/);
  assert.throws(() => brochurePagesToImport([], 14, id, new Set()), /between 1 and 10/);
  assert.throws(() => brochurePagesToImport(Array.from({ length: 11 }, (_, i) => i + 1), 14, id, new Set()), /between 1 and 10/);
  assert.throws(() => brochurePagesToImport(['x'], 14, id, new Set()), /aren't in this brochure/);
});

// The Royal Exchange's SharePoint "Floor Plans" folder, 2026-09.
const ROOT = 'BGP share drive/London/The Royal Exchange';
const FP = `${ROOT}/Floor Plans`;
const sp = (name, path, extra = {}) => ({ name, path, webUrl: `https://x/${encodeURIComponent(path)}/${encodeURIComponent(name)}`, driveId: 'D', itemId: name, size: 500_000, lastModified: '2026-09-08T10:32:00Z', source: 'folder', ...extra });
const floorPlansFolder = [
  sp('2021 CBRE Internal Area Report Royal Exchange-November.pdf', FP),
  sp('4314-MEZZ-001  Mezz As Installed-A0.pdf', FP),
  sp('Fortnum and Mason Licence plan draft.jpg', FP, { size: 2_375_896 }),
  sp('Fortnum and Mason Licence plan draft.pdf', FP, { size: 2_379_972 }),
  sp('Fortnum and Mason Licence plan draft.psd', FP),
  sp('Unit 16-17 plans.pdf', FP),
  sp('Unit 5 Royal Exchange.pdf', FP),
  sp('Plan for 2-3 Royal Exchange (external).pdf', `${FP}/Unit 2-3`),
  sp('21668-SK-20220107_Mez Typical Section.pdf', `${FP}/GA plans`),
  sp('RoyalExchange_final Jan 18.pdf', `${FP}/GA plans`),
  sp('Upper floor plans - date TBC - provided by AS.pdf', `${FP}/GA plans`),
  sp('21668-01-101D.pdf', `${FP}/GA plans/Floor plans`),
  sp('21668-01-099B.pdf', `${FP}/GA plans/Floor plans`),
  sp('21668-01-100D.pdf', `${FP}/GA plans/Floor plans`),
  sp('4241-B.pdf', `${FP}/GA plans/MSA survey 2015 drawings - provided by AS`),
  sp('Front elevation.pdf', `${FP}/GA plans/Elevations`),
  sp('334451-01.dwg', `${FP}/CAD plans`),
  sp('Royal_Exchange_Brochure_Dec 25.pdf', `${ROOT}/Marketing`),
  sp('Lease - Unit 12 2019.pdf', `${ROOT}/Leases`),
];

test('plan tiers: plan names and Floor Plans / GA / drawings folders count; sections, elevations and brochures do not', () => {
  assert.equal(planTier('Upper floor plans - date TBC - provided by AS.pdf', `${FP}/GA plans`), 5);
  assert.equal(planTier('21668-01-100D.pdf', `${FP}/GA plans/Floor plans`), 2);
  assert.equal(planTier('4241-B.pdf', `${FP}/GA plans/MSA survey 2015 drawings - provided by AS`), 2);
  assert.equal(planTier('Goad plan.pdf', 'Somewhere'), 3);
  assert.equal(planTier('Retail GA.pdf', 'Somewhere'), 3);
  assert.equal(planTier('21668-SK-20220107_Mez Typical Section.pdf', `${FP}/GA plans`), 0);
  assert.equal(planTier('Front elevation.pdf', `${FP}/GA plans/Elevations`), 0);
  assert.equal(planTier('Royal_Exchange_Brochure_Dec 25.pdf', `${ROOT}/Marketing`), 0);
  assert.equal(planTier('Lease - Unit 12 2019.pdf', `${ROOT}/Leases`), 0);
  assert.equal(planTier('Planning statement.pdf', ROOT), 0, 'planning is not a plan');
});

test('Royal Exchange plans: whole-building drawings first, single units after, non-plans left out', () => {
  const ranked = rankPlanCandidates(floorPlansFolder).map(c => c.name);
  assert.equal(ranked[0], 'Upper floor plans - date TBC - provided by AS.pdf');
  for (const name of ['21668-01-099B.pdf', '21668-01-100D.pdf', '21668-01-101D.pdf']) assert.ok(ranked.indexOf(name) < ranked.indexOf('Unit 5 Royal Exchange.pdf'), `${name} before unit plans`);
  assert.ok(ranked.indexOf('21668-01-099B.pdf') < ranked.indexOf('21668-01-100D.pdf') && ranked.indexOf('21668-01-100D.pdf') < ranked.indexOf('21668-01-101D.pdf'), 'a drawing set stays in number order');
  assert.ok(ranked.indexOf('Fortnum and Mason Licence plan draft.pdf') < ranked.indexOf('Fortnum and Mason Licence plan draft.jpg'), 'the PDF of a drawing ranks above its image export');
  const units = ['Unit 16-17 plans.pdf', 'Unit 5 Royal Exchange.pdf', 'Plan for 2-3 Royal Exchange (external).pdf'];
  for (const name of units) assert.ok(ranked.indexOf(name) > ranked.indexOf('4241-B.pdf'), `${name} after whole-building plans`);
  for (const name of ['21668-SK-20220107_Mez Typical Section.pdf', 'Front elevation.pdf', '334451-01.dwg', 'Fortnum and Mason Licence plan draft.psd', 'Royal_Exchange_Brochure_Dec 25.pdf', 'Lease - Unit 12 2019.pdf']) {
    assert.equal(ranked.includes(name), false, `${name} is left out`);
  }
});

test('plans from the linked folder: plan folders are walked first and images are included', async () => {
  const DRIVE = 'b!drive';
  const item = (id, name, extra = {}) => ({ id, name, size: 100_000, file: {}, lastModifiedDateTime: '2026-09-08T10:00:00Z', webUrl: `https://x/${id}`, parentReference: { driveId: DRIVE, path: `/drives/${DRIVE}/root:/${extra.path}` } });
  const children = {
    ROOT: [{ id: 'LEASES', name: 'Leases', folder: {} }, { id: 'FP', name: 'Floor Plans', folder: {} }],
    FP: [item('G', 'Ground floor plan.jpg', { path: FP }), { id: 'GAF', name: 'GA plans', folder: {} }, item('DWG', 'x.dwg', { path: FP })],
    GAF: [item('B', '21668-01-099B.pdf', { path: `${FP}/GA plans` })],
    LEASES: [item('L', 'Lease - Unit 12 2019.pdf', { path: `${ROOT}/Leases` })],
  };
  const listed = [];
  const graph = async (path, options = {}) => {
    if (path.startsWith('/shares/')) return { id: 'ROOT', name: 'The Royal Exchange', parentReference: { driveId: DRIVE } };
    if (path === '/search/query') { assert.match(JSON.parse(options.body).requests[0].query.queryString, /filetype:png OR filetype:jpg/); return { value: [] }; }
    const id = path.match(/\/items\/([^/]+)\/children/)?.[1];
    if (id) { listed.push(id); return { value: children[id] || [] }; }
    throw new Error(`unexpected Graph call ${path}`);
  };
  const pool = { query: async (sql) => /FROM crm_properties/.test(sql) ? { rows: [{ name: 'Royal Exchange', sharepoint_folder_url: 'https://brucegillinghampollardlimited.sharepoint.com/sites/BGP/x' }] } : { rows: [] } };
  const out = await findPropertyFiles(pool, 'rex', 'plan', 'leasing', { graph });
  assert.deepEqual(out.candidates.map(c => c.name), ['Ground floor plan.jpg', '21668-01-099B.pdf']);
  assert.deepEqual(listed.slice(0, 3), ['ROOT', 'FP', 'LEASES'], 'Floor Plans is listed before Leases');
});
