import assert from 'node:assert/strict';
import test from 'node:test';
import AdmZip from 'adm-zip';
import XLSX from 'xlsx';
import { parseEvidenceWorkbook } from '../../server/evidence-plan-workbook.ts';

function workbook(sheets, format = 'xlsx') {
  const book = XLSX.utils.book_new();
  for (const [name, sheet] of Object.entries(sheets)) XLSX.utils.book_append_sheet(book, sheet, name);
  return XLSX.write(book, { type: 'buffer', bookType: format === 'xls' ? 'biff8' : 'xlsx' });
}

function tasSheet() {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Transaction Analysis'],
    ['Unit T12 - Example Retailer'],
    ['Transaction:', null, null, 'Open Market letting'],
    ['Proposed Term:', null, null, '5 years from completion'],
    ['Base/headline Rent:', null, null, 84000, 'pa', null, 'Net rent:', '£77,700 pa'],
    ['Incentives:', null, null, '3 months rent free'],
    [],
    [null, null, null, null, null, null, null, null, 129.5, 'psf ITZA'],
    ['Floor', 'Description', null, 'Area', 'Rate ITZA'],
    ['Ground', 'Sales', 'Zone A', 400],
    [null, null, 'Zone B', 400],
    [null, null, 'GIA', 1850],
    [null, null, 'ITZA', 600],
    ['ASSET MANAGER:', null, null, null, null, null, null, 'Date:'],
  ]);
  sheet.D12 = { t: 'n', f: 'SUM(1000,850)', v: 1850 };
  sheet.D13 = { t: 'n', f: 'SUM(400,200)', v: 600 };
  return sheet;
}

for (const format of ['xls', 'xlsx']) {
  test(`${format} reads TAS saved values, keeps GIA and ITZA separate, and ignores the file identity`, () => {
    const buffer = Buffer.from(workbook({ 'Rent analysis': tasSheet(), Blank: XLSX.utils.aoa_to_sheet([]) }, format));
    const original = Buffer.from(buffer);
    const result = parseEvidenceWorkbook(buffer, `Different tenant - Unit A99 - 2025-01-01.${format}`);
    assert.deepEqual(result.candidates, [{
      sheetName: 'Rent analysis', unitRef: 'T12', tenant: 'Example Retailer',
      transactionType: 'Open Market letting', transactionDate: null, sizeSqft: 1850,
      zoneA: 129.5, itza: 600, headlineRent: 84000, netEffective: 77700,
      term: '5 years from completion', concession: '3 months rent free', notes: null,
    }]);
    assert.deepEqual(buffer, original, 'reading must not rewrite the supplied document');
    assert.ok(result.warnings.some(message => /last saved version/.test(message)));
  });
}

test('label aliases, numeric zero, currency strings, explicit UK dates and optional blank fields are preserved', () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Unit reference', 'Unit L4'], ['Occupier name', 'Example Shop'], ['Deal type', 'Rent review'],
    ['Transaction date', '22/09/2026'], ['Headline rent p.a.', '£50,000.25'],
    ['Net effective rent', 0], ['Total area sq ft', '1,000 sq ft'], ['ITZA area', 650],
    ['Zone A rate', '76.92 psf'], ['Concessions', 'None'], ['Notes', 'Subject to confirmation'],
    ['Proposed term'],
  ]);
  const value = parseEvidenceWorkbook(workbook({ TAS: sheet }), 'tas.xlsx').candidates[0];
  assert.equal(value.unitRef, 'L4');
  assert.equal(value.tenant, 'Example Shop');
  assert.equal(value.transactionDate, '2026-09-22');
  assert.equal(value.headlineRent, 50000.25);
  assert.equal(value.netEffective, 0);
  assert.equal(value.sizeSqft, 1000);
  assert.equal(value.itza, 650);
  assert.equal(value.zoneA, 76.92);
  assert.equal(value.term, null);
});

test('formula results are read as stored and formulas with no cached values are never evaluated', () => {
  const sheet = XLSX.utils.aoa_to_sheet([['Headline rent', 123], ['Net rent', 456], ['ITZA', 700]]);
  sheet.B1 = { t: 'n', v: 123, f: '999999+1' };
  sheet.B2 = { t: 'n', v: 456, f: 'WEBSERVICE("https://example.invalid/never-call")' };
  sheet.B3 = { t: 'n', v: 700, f: 'SUM(600,100)' };
  const zip = new AdmZip(workbook({ TAS: sheet }));
  const xml = zip.readAsText('xl/worksheets/sheet1.xml');
  zip.updateFile('xl/worksheets/sheet1.xml', Buffer.from(xml.replace(/(<c r="B2"[^>]*>.*?<f>.*?<\/f>)<v>456<\/v>/, '$1')));
  const result = parseEvidenceWorkbook(zip.toBuffer(), 'tas.xlsx');
  assert.equal(result.candidates[0].headlineRent, 123, 'do not recalculate even a simple formula');
  assert.equal(result.candidates[0].netEffective, null);
  assert.equal(result.candidates[0].itza, 700);
  assert.ok(result.warnings.some(message => /B2: net rent has no saved calculation result/.test(message)));
});

test('conflicting labels are not silently replaced by the last value or another sheet', () => {
  const first = XLSX.utils.aoa_to_sheet([['Unit', 'A1'], ['Headline rent', 100], ['Base rent', 200]]);
  const second = XLSX.utils.aoa_to_sheet([['Unit', 'A2'], ['Headline rent', 300]]);
  const result = parseEvidenceWorkbook(workbook({ First: first, Second: second }), 'tas.xlsx');
  assert.equal(result.candidates[0].headlineRent, null);
  assert.equal(result.candidates[1].headlineRent, 300);
  assert.equal(result.candidates[0].unitRef, 'A1');
  assert.equal(result.candidates[1].unitRef, 'A2');
  assert.ok(result.warnings.some(message => /conflicting headline rent/.test(message)));
});

test('negative amounts, percentages, invalid dates, errors and metric areas are not invented as evidence', () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Headline rent', -1], ['Net rent', '12%'], ['Transaction date', '31/02/2026'],
    ['Zone A rate', 0.5], ['ITZA', 'bad value'], ['Total area (sq m)', 100],
  ]);
  sheet.B4.z = '0%';
  const result = parseEvidenceWorkbook(workbook({ TAS: sheet }), 'tas.xlsx');
  for (const key of ['headlineRent', 'netEffective', 'transactionDate', 'zoneA', 'itza', 'sizeSqft']) {
    assert.equal(result.candidates[0][key], null, key);
  }
  assert.ok(result.warnings.some(message => /could not be read reliably/.test(message)));
});

test('unknown workbooks allow manual entry, while genuinely empty sheets are skipped', () => {
  const result = parseEvidenceWorkbook(workbook({ Notes: XLSX.utils.aoa_to_sheet([['Unstructured evidence', 100]]) }), 'unit-A1.xlsx');
  assert.equal(result.candidates.length, 1);
  assert.deepEqual(Object.values(result.candidates[0]).slice(1), Array(12).fill(null));
  assert.ok(result.warnings.some(message => /enter the evidence manually/.test(message)));
  const empty = parseEvidenceWorkbook(workbook({ Empty: XLSX.utils.aoa_to_sheet([]) }), 'empty.xlsx');
  assert.equal(empty.candidates.length, 1);
  assert.equal(empty.candidates[0].sheetName, 'Empty');
  assert.ok(empty.warnings.some(message => /no populated sheets/.test(message)));
});

test('saved rent basis annotations are preserved alongside separate concessions without recomputing either', () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Net rent', '£50,000 pa', '(amortising 6m rent free over 5 years)'],
    ['Incentives', '9m rent free'], ['Notes', 'Check analysis basis with agent'],
  ]);
  const result = parseEvidenceWorkbook(workbook({ TAS: sheet }), 'tas.xlsx').candidates[0];
  assert.equal(result.netEffective, 50000);
  assert.equal(result.concession, '9m rent free');
  assert.equal(result.notes, 'Net rent: (amortising 6m rent free over 5 years)\nCheck analysis basis with agent');
});

test('invalid, oversized, macro-enabled and out-of-range workbooks are rejected', () => {
  assert.throws(() => parseEvidenceWorkbook(Buffer.from('Unit A1,100'), 'not-excel.xlsx'), /not a supported Excel/);
  assert.throws(() => parseEvidenceWorkbook(workbook({ TAS: tasSheet() }), 'tas.xlsm'), /\.xls or \.xlsx/);
  assert.throws(() => parseEvidenceWorkbook(Buffer.alloc(20 * 1024 * 1024 + 1), 'large.xls'), /20 MB/);
  const many = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`Sheet${i}`, XLSX.utils.aoa_to_sheet([['x']])]));
  assert.throws(() => parseEvidenceWorkbook(workbook(many), 'many.xlsx'), /20 sheets/);
  const wide = XLSX.utils.aoa_to_sheet([['x']]);
  wide.IW1 = { t: 'n', v: 1 }; wide['!ref'] = 'A1:IW1';
  assert.throws(() => parseEvidenceWorkbook(workbook({ Wide: wide }), 'wide.xlsx'), /256-column/);
  const tall = XLSX.utils.aoa_to_sheet([['x']]);
  tall.A1001 = { t: 'n', v: 1 }; tall['!ref'] = 'A1:A1001';
  assert.throws(() => parseEvidenceWorkbook(workbook({ Tall: tall }), 'tall.xlsx'), /1000-row/);
  const macro = new AdmZip(workbook({ TAS: tasSheet() }));
  macro.addFile('xl/vbaProject.bin', Buffer.from('not-executable'));
  assert.throws(() => parseEvidenceWorkbook(macro.toBuffer(), 'tas.xlsx'), /Macro-enabled/);
});

// Reproduces the uploaded B6 TAS layout: separate colon cells, a location in
// the title and a calculation row whose Zone A figure is an explicit rate.
function zonedRenewalSheet() {
  const sheet = XLSX.utils.aoa_to_sheet([]);
  const rows = {
    1: ['Transaction Analysis'], 4: ['Unit B6, Brent Cross - Hotel Chocolat'],
    8: ['Transaction', null, null, ':', 'LR'],
    10: ['Proposed Term', null, null, ':', '5 years from 3 August 2027', null, null, 'Outside Act'],
    12: ['Headline Rent', null, null, ':', 135000, 'pa '],
    14: ['Incentives', null, null, ':', '3m rent free'],
    18: ['Rent Review ', null, 'Date', ':', 'N/A'],
    26: ['Areas', null, null, ':', 'Zone A', 295],
    27: [null, null, null, null, 'Zone B', 296],
    28: [null, null, null, null, 'Zone C', 295],
    29: [null, null, null, null, 'Zone D', 341],
    30: [null, null, null, null, 'TOTAL', 1227],
    31: ['Headline rent', null, null, null, 'ITZA', 559, 'sq ft @', 241.5026833631485, 135000],
  };
  for (const [row, cells] of Object.entries(rows)) XLSX.utils.sheet_add_aoa(sheet, [cells], { origin: `A${row}` });
  sheet.F30 = { t: 'n', f: 'SUM(F26:F29)', v: 1227 };
  sheet.I31 = { t: 'n', f: 'H31*F31', v: 135000 };
  sheet['!ref'] = 'A1:I43';
  return sheet;
}

for (const format of ['xls', 'xlsx']) {
  test(`${format} reads B6 formatted renewal evidence without swallowing separators or confusing Zone A area with rent`, () => {
    const source = Buffer.from(workbook({ '2024 RR': zonedRenewalSheet() }, format));
    const original = Buffer.from(source);
    const result = parseEvidenceWorkbook(source, `Hotel Chocolat B6.${format}`);
    assert.deepEqual(result.candidates[0], {
      sheetName: '2024 RR', unitRef: 'B6', tenant: 'Hotel Chocolat', transactionType: 'LR',
      transactionDate: '2027-08-03', term: '5 years from 3 August 2027', sizeSqft: 1227,
      itza: 559, zoneA: 241.5026833631485, headlineRent: 135000, netEffective: null,
      concession: '3m rent free', notes: null,
    });
    assert.equal(result.warnings.length, 1, 'no warning for formatting colon or duplicate identical rent');
    assert.deepEqual(source, original, 'the original source remains unchanged');
    assert.equal(Object.hasOwn(result.candidates[0], 'passingRent'), false);
    assert.equal(Object.hasOwn(result.candidates[0], 'leaseExpiry'), false);
  });
}

test('a blank rate does not shift the annual rent into Zone A and calculated totals are not recomputed', () => {
  const sheet = zonedRenewalSheet();
  delete sheet.H31;
  sheet.F30 = { t: 'n', f: 'SUM(F26:F29)', v: 1227 };
  const zip = new AdmZip(workbook({ TAS: sheet }));
  const xml = zip.readAsText('xl/worksheets/sheet1.xml');
  zip.updateFile('xl/worksheets/sheet1.xml', Buffer.from(xml.replace(/(<c r="F30"[^>]*>.*?<f>.*?<\/f>)<v>1227<\/v>/, '$1')));
  const result = parseEvidenceWorkbook(zip.toBuffer(), 'tas.xlsx');
  assert.equal(result.candidates[0].zoneA, null);
  assert.equal(result.candidates[0].headlineRent, 135000);
  assert.equal(result.candidates[0].sizeSqft, null);
  assert.ok(result.warnings.some(warning => /F30: area in sq ft has no saved calculation result/.test(warning)));
});

test('formatted calculation rows preserve conflict warnings and do not reinterpret net rates as headline Zone A', () => {
  const sheet = zonedRenewalSheet();
  sheet.I31.v = 140000;
  XLSX.utils.sheet_add_aoa(sheet, [['Zone A rate', 300]], { origin: 'A35' });
  const result = parseEvidenceWorkbook(workbook({ TAS: sheet }), 'tas.xlsx');
  assert.equal(result.candidates[0].headlineRent, null);
  assert.equal(result.candidates[0].zoneA, null);
  assert.ok(result.warnings.some(warning => /conflicting headline rent/.test(warning)));
  assert.ok(result.warnings.some(warning => /conflicting Zone A rate/.test(warning)));
  const net = XLSX.utils.aoa_to_sheet([['Net rent', null, null, null, 'ITZA', 500, 'sq ft @', 100, 50000]]);
  const netResult = parseEvidenceWorkbook(workbook({ TAS: net }), 'tas.xlsx').candidates[0];
  assert.equal(netResult.netEffective, 50000);
  assert.equal(netResult.headlineRent, null);
  assert.equal(netResult.zoneA, null);
});

test('unlabelled totals and metric calculation rows are not accepted as square-foot area or Zone A rates', () => {
  const sheet = zonedRenewalSheet();
  sheet.G31.v = 'sq m @';
  const metric = parseEvidenceWorkbook(workbook({ TAS: sheet }), 'tas.xlsx').candidates[0];
  assert.equal(metric.sizeSqft, null);
  assert.equal(metric.zoneA, null);
  const unrelated = XLSX.utils.aoa_to_sheet([['Total', 999], ['Zone A', 295]]);
  const other = parseEvidenceWorkbook(workbook({ TAS: unrelated }), 'tas.xlsx').candidates[0];
  assert.equal(other.sizeSqft, null); assert.equal(other.zoneA, null);
});

test('multiple coded unit references remain intact and explicit term dates retain conflict checks', () => {
  const sheet = zonedRenewalSheet();
  sheet.A4.v = 'Unit B6, B7 - Hotel Chocolat';
  XLSX.utils.sheet_add_aoa(sheet, [['Transaction date', ':', '2026-01-01']], { origin: 'A36' });
  const result = parseEvidenceWorkbook(workbook({ TAS: sheet }), 'tas.xlsx');
  assert.equal(result.candidates[0].unitRef, 'B6, B7');
  assert.equal(result.candidates[0].transactionDate, null);
  assert.ok(result.warnings.some(warning => /conflicting transaction date/.test(warning)));
  sheet.E10.v = '5 years from 31 February 2027';
  delete sheet.A36; delete sheet.B36; delete sheet.C36;
  assert.equal(parseEvidenceWorkbook(workbook({ TAS: sheet }), 'tas.xlsx').candidates[0].transactionDate, null);
});

test('comma-separated unit groups with words or repeated Unit and Shop prefixes are never stripped as locations', () => {
  for (const references of ['B6, B7 and B8', 'B6, Unit B7', 'B6, Shop B7', 'B6, Shops B7 and B8',
    'B6, B7/B8', 'B6, B7-B9', 'B6, B7 & B8', 'B6, 7 and 8']) {
    const sheet = XLSX.utils.aoa_to_sheet([[`Unit ${references} - Example tenant`]]);
    const result = parseEvidenceWorkbook(workbook({ TAS: sheet }), 'tas.xlsx').candidates[0];
    assert.equal(result.unitRef, references, references);
    assert.equal(result.tenant, 'Example tenant');
  }
  const located = XLSX.utils.aoa_to_sheet([['Unit B6, Brent Cross - Example tenant']]);
  assert.equal(parseEvidenceWorkbook(workbook({ TAS: located }), 'tas.xlsx').candidates[0].unitRef, 'B6');
});
