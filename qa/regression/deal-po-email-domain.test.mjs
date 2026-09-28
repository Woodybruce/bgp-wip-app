// PO-required clients and the company email-domain move (Canary Wharf
// Group, 2026-09-28: "No PO No Pay"; canarywharf.com → cwg.com).
import assert from 'node:assert/strict';
import test from 'node:test';
import { dealPoCheck, poMissingMessage, poRequiredSql, hasPo } from '../../server/deal-po.ts';
import { normaliseEmailDomain, planEmailDomainMove, moveCompanyEmailDomain } from '../../server/contact-email-domain.ts';

test('the PO rule covers the billed parties and their parent company', () => {
  const sql = poRequiredSql('d');
  for (const part of ['d.landlord_id', 'd.vendor_id', 'd.purchaser_id', "d.bgp_acting_for = 'tenant' THEN d.tenant_id", 'p.landlord_id', 's.billing_entity_id', 'parent.requires_po IS TRUE', 'c.requires_po IS TRUE']) {
    assert.ok(sql.includes(part), part);
  }
  assert.equal(hasPo('  '), false);
  assert.equal(hasPo('PO-1234'), true);
});

function poPool({ poNumber = null, requiredBy = [{ id: 'cwg', name: 'Canary Wharf Group' }] } = {}) {
  return {
    query: async (sql, params) => {
      if (/SELECT id, po_number FROM crm_deals/.test(sql)) return { rows: params[0] === 'missing' ? [] : [{ id: params[0], po_number: poNumber }] };
      if (/LATERAL/.test(sql)) return { rows: requiredBy };
      throw new Error(`unexpected ${sql}`);
    },
  };
}

test('a deal billed to a PO client with no PO number is flagged, with who asks', async () => {
  const check = await dealPoCheck(poPool(), 'deal1');
  assert.deepEqual(check, { required: true, missing: true, requiredBy: [{ id: 'cwg', name: 'Canary Wharf Group' }], poNumber: null });
  assert.match(poMissingMessage(check), /^Canary Wharf Group only pays invoices that quote a PO number/);
  assert.equal((await dealPoCheck(poPool({ poNumber: ' 4500123 ' }), 'deal1')).missing, false);
  assert.deepEqual(await dealPoCheck(poPool({ requiredBy: [] }), 'deal1'), { required: false, missing: false, requiredBy: [], poNumber: null });
  assert.equal(await dealPoCheck(poPool(), 'missing'), null);
});

test('domains normalise; anything that is not a domain is refused', () => {
  assert.equal(normaliseEmailDomain(' @CanaryWharf.com '), 'canarywharf.com');
  assert.equal(normaliseEmailDomain('https://cwg.com/'), 'cwg.com');
  for (const bad of ['', 'cwg', 'a@b.com', 'not a domain.com', '-x.com']) assert.equal(normaliseEmailDomain(bad), null, bad);
});

test('the move keeps the local part and skips addresses already taken', () => {
  const contacts = [
    { id: 'a', name: 'Ann', email: 'Ann.Smith@CanaryWharf.com' },
    { id: 'b', name: 'Bob', email: 'bob@canarywharf.com' },
    { id: 'c', name: 'Cat', email: 'cat@other.com' },
    { id: 'd', name: 'Dup', email: 'BOB@canarywharf.com' },
  ];
  assert.deepEqual(planEmailDomainMove(contacts, 'canarywharf.com', 'cwg.com', new Set(['ann.smith@cwg.com'])), [
    { id: 'a', name: 'Ann', from: 'Ann.Smith@CanaryWharf.com', to: 'Ann.Smith@cwg.com', skipped: 'Ann.Smith@cwg.com is already another contact\'s email' },
    { id: 'b', name: 'Bob', from: 'bob@canarywharf.com', to: 'bob@cwg.com', skipped: null },
    { id: 'd', name: 'Dup', from: 'BOB@canarywharf.com', to: 'BOB@cwg.com', skipped: 'BOB@cwg.com is already another contact\'s email' },
  ]);
});

function domainPool() {
  const writes = [];
  return {
    writes,
    query: async (sql, params) => {
      if (/FROM crm_companies WHERE id/.test(sql)) return { rows: params[0] === 'cwg' ? [{ id: 'cwg', name: 'Canary Wharf Group' }] : [] };
      if (/FROM crm_contacts WHERE company_id/.test(sql)) {
        assert.deepEqual(params, ['cwg', 'canarywharf.com'], 'only this company, only the old domain');
        return { rows: [{ id: 'a', name: 'Ann', email: 'ann@canarywharf.com' }, { id: 'b', name: 'Bob', email: 'bob@canarywharf.com' }] };
      }
      if (/lower\(trim\(email\)\) = ANY/.test(sql)) return { rows: [{ email: 'bob@cwg.com' }] };
      if (/^UPDATE crm_contacts/.test(sql.trim())) { writes.push(params); return { rows: [], rowCount: 1 }; }
      throw new Error(`unexpected ${sql}`);
    },
  };
}

test('preview changes nothing; apply rewrites only the free addresses, guarded on the previewed value', async () => {
  const preview = domainPool();
  const p = await moveCompanyEmailDomain(preview, 'cwg', 'canarywharf.com', 'cwg.com', false);
  assert.equal(p.applied, false);
  assert.equal(p.changed, 0);
  assert.equal(preview.writes.length, 0);
  assert.deepEqual(p.rows.map(r => [r.to, !!r.skipped]), [['ann@cwg.com', false], ['bob@cwg.com', true]]);

  const apply = domainPool();
  const a = await moveCompanyEmailDomain(apply, 'cwg', 'canarywharf.com', 'cwg.com', true);
  assert.equal(a.changed, 1);
  assert.deepEqual(apply.writes, [['a', 'ann@cwg.com', 'cwg', 'ann@canarywharf.com']]);

  await assert.rejects(moveCompanyEmailDomain(domainPool(), 'cwg', 'cwg.com', 'CWG.com', false), e => e.status === 400);
  await assert.rejects(moveCompanyEmailDomain(domainPool(), 'cwg', 'nope', 'cwg.com', false), e => e.status === 400);
  await assert.rejects(moveCompanyEmailDomain(domainPool(), 'x', 'canarywharf.com', 'cwg.com', false), e => e.status === 404);
});
