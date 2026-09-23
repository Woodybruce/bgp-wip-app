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
