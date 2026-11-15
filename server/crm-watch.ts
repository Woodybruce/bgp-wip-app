// Closer watching for companies on the CRM (Woody, 2026-11-15: "we choose who
// to make VIP and then the CRM engine ... closely watches them more than
// other CRMs"). A company on a strategy that is running goes to the front of
// the nightly brand jobs (store count, planning and job adverts, the accounts
// read, the signal tidy) and is re-checked weekly, not monthly.
export const WATCH_RECHECK_DAYS = 7;
export const onStrategySql = (alias: string) =>
  `EXISTS (SELECT 1 FROM crm_strategy_targets wt JOIN marketing_campaigns ws ON ws.id = wt.strategy_id WHERE wt.company_id = ${alias}.id AND ws.status = 'active')`;
