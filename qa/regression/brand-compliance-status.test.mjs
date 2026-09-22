import test from 'node:test';
import assert from 'node:assert/strict';
import { brandComplianceStatus } from '../../shared/brand-compliance-status.ts';

const now = new Date('2026-09-17T12:00:00Z');
const company = { uk_entity_name: 'COOK Trading Ltd', companies_house_number: '04611064', companies_house_data: { profile: { companyName: 'COOK TRADING LIMITED', companyNumber: '04611064' } }, aml_pep_status: 'clear' };
test('all collected checks and clear screening do not invent KYC approval', () => {
  const result = brandComplianceStatus(company, [], now);
  assert.equal(result.label, 'Checks collected — approval not recorded');
  assert.equal(result.recordedApproval, false);
  assert.deepEqual(result.identityIssues, []);
});
test('explicit approval is shown only as a recorded decision and respects expiry', () => {
  assert.equal(brandComplianceStatus({ ...company, kyc_status: 'approved', kyc_expires_at: '2027-01-01' }, [], now).label, 'KYC approval recorded');
  assert.equal(brandComplianceStatus({ ...company, kyc_status: 'approved', kyc_expires_at: '2026-09-17T12:00:00Z' }, [], now).label, 'KYC review expired');
  assert.equal(brandComplianceStatus({ ...company, kyc_status: 'approved' }, [], now).label, 'KYC approval recorded — review date not set');
  assert.equal(brandComplianceStatus({ ...company, kyc_status: 'approved', kyc_expires_at: 'invalid' }, [], now).label, 'KYC approval recorded — review date not set');
});
test('an unresolved screening result is not presented as approval', () => {
  for (const aml_pep_status of ['review_required', 'potential_match', 'strong_match']) {
    const result = brandComplianceStatus({ ...company, aml_pep_status, kyc_status: 'approved' }, [], now);
    assert.equal(result.label, 'Screening results need review');
    assert.equal(result.recordedApproval, false);
  }
});
test('a reviewed PEP status does not automatically reverse an explicit approval', () => {
  assert.equal(brandComplianceStatus({ ...company, aml_pep_status: 'pep_domestic', kyc_status: 'approved', kyc_expires_at: '2027-01-01' }, [], now).label, 'KYC approval recorded');
});
test('different entity names or company numbers call for review without changing records', () => {
  const mismatched = { ...company, uk_entity_name: 'Digimedia.com, LP', kyc_status: 'approved' };
  const original = JSON.stringify(mismatched);
  const result = brandComplianceStatus(mismatched, [], now);
  assert.equal(result.label, 'Legal entity needs review');
  assert.match(result.identityIssues[0], /Digimedia.*COOK TRADING LIMITED/);
  assert.equal(result.recordedApproval, false);
  assert.equal(JSON.stringify(mismatched), original);
  assert.match(brandComplianceStatus({ ...company, companies_house_number: '02884870' }, [], now).identityIssues[0], /number differs/);
});
test('snake-case records and punctuation differences are handled without a false mismatch', () => {
  const c = { uk_entity_name: 'Acme & Sons Ltd.', companies_house_number: 'SC012345', companies_house_data: { profile: { company_name: 'ACME AND SONS LIMITED', company_number: 'sc012345' } } };
  assert.deepEqual(brandComplianceStatus(c, [], now).identityIssues, []);
});
test('rejection and missing records remain explicit', () => {
  assert.equal(brandComplianceStatus({ kyc_status: 'rejected' }, ['Accounts'], now).label, 'KYC rejected — review the recorded decision');
  const result = brandComplianceStatus({}, ['Companies House profile'], now);
  assert.equal(result.label, 'Checks still to collect');
  assert.deepEqual(result.missing, ['Companies House profile']);
});
