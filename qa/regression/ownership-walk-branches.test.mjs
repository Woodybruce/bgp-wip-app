// Every corporate owner above the subject is walked, not only the largest
// (Woody, 25 November 2026: ST JOHN'S HILL PH03 LLP, owned half and half by
// Mount Anvil SJH Limited and Peabody Developments Limited, a registered
// society Companies House holds no PSC register for, read as having no owners).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { find, evaluate } = require('./source-harness.cjs');

const FILE = 'server/companies-house.ts';

function load(registers) {
  const src = [
    find(FILE, (n, ast) => n.kind && n.getText(ast).startsWith('const chainDob')),
    find(FILE, (n, ast) => n.kind && n.getText(ast).startsWith('const pscRegister')),
    find(FILE, (n, ast) => n.kind && n.getText(ast).startsWith('export async function discoverUltimateParent')),
  ].join('\n');
  const { ownerRegister } = require('../../shared/kyc-prechecks.ts');
  return evaluate(src, {
    require: name => { if (name === '@shared/kyc-prechecks') return { ownerRegister }; throw new Error(`Unexpected module ${name}`); },
    chFetch: async path => {
      const num = path.split('/')[2];
      if (!(num in registers)) throw new Error('404');
      return { items: registers[num] };
    },
  }).discoverUltimateParent;
}

const corp = (name, number, band) => ({ kind: 'corporate-entity-person-with-significant-control', name, natures_of_control: [`ownership-of-shares-${band}-percent`], identification: { registration_number: number, country_registered: 'England' } });

test('a joint venture: both owners are walked, and the people behind the one with a register are found', async () => {
  const walk = load({
    OC443074: [corp('Peabody Developments Limited', 'IP26804R', '25-to-50'), corp('Mount Anvil SJH Limited', '12345678', '25-to-50')],
    '12345678': [corp('Mount Anvil Group Limited', '07000000', '75-to-100')],
    '07000000': [{ kind: 'individual-person-with-significant-control', name: 'Mr Killian HURLEY', nationality: 'Irish', natures_of_control: ['ownership-of-shares-25-to-50-percent'], date_of_birth: { month: 1, year: 1966 } }],
  });
  const r = JSON.parse(JSON.stringify(await walk('OC443074')));
  assert.deepEqual(r.chain.map(c => c.name), ['Mount Anvil SJH Limited', 'Mount Anvil Group Limited']);
  assert.deepEqual(r.ubos.map(u => [u.name, u.foundAt]), [['Mr Killian HURLEY', 'Mount Anvil Group Limited']]);
});

test('a single line is walked as before, and its top stays the ultimate parent', async () => {
  const walk = load({
    '11111111': [corp('Holdco Limited', '22222222', '75-to-100'), corp('Minority Limited', '33333333', '25-to-50')],
    '22222222': [corp('Topco Limited', '44444444', '75-to-100')],
    '44444444': [],
    '33333333': [],
  });
  const r = JSON.parse(JSON.stringify(await walk('11111111')));
  assert.deepEqual(r.ultimateParent, { name: 'Topco Limited', number: '44444444' });
  assert.deepEqual(r.chain.map(c => c.name), ['Holdco Limited', 'Topco Limited', 'Minority Limited']);
});
