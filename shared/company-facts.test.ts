import test from "node:test";
import assert from "node:assert/strict";
import { companyFacts, isPlcRecord, recordCheckRows, servingDirectors } from "./company-facts";

// A listed plc as the app holds one: the PSC register was read and is empty,
// officers are held, the group accounts PDF is held, and its own read of the
// accounts came back empty with the period cut to a weekday and month.
const plc = {
  companies_house_number: "00502851",
  stock_ticker: null,
  last_accounts_made_up_to: "2025-12-27",
  last_accounts_storage_key: "accounts.pdf",
  annual_report_storage_key: null,
  companies_house_data: {
    profile: {
      companyType: "plc", companyStatus: "active", dateOfCreation: "1951-12-29", sicCodes: ["10710", "47240"],
      registeredOfficeAddress: { address_line_1: "Greggs House", address_line_2: "Quorum Business Park", locality: "Newcastle Upon Tyne", postal_code: "NE12 8BU" },
      accountsOverdue: false, confirmationStatementOverdue: false, lastAccountsMadeUpTo: "2025-12-27", hasCharges: false, hasInsolvencyHistory: false,
    },
    officers: [
      { name: "A", officerRole: "director" }, { name: "B", officerRole: "director" },
      { name: "C", officerRole: "director", resignedOn: "2024-01-01" }, { name: "D", officerRole: "secretary" },
    ],
    pscs: [],
    fetchStatus: { pscs: "ok", officers: "ok" },
    latestAccountsExtracted: { period: "Sat Dec 27", turnover: null, profitBeforeTax: "not found", netAssets: null, cash: null, retriedEmpty: true },
  },
};
const report = {
  signals: {
    status: "active", accountsOverdue: false, nextAccountsDue: "2027-06-30", outstandingCharges: 0, insolvencyCases: 0,
    gazetteNotices: [], gazetteChecked: true, directorRisk: { activeDirectors: 8 }, paymentPractices: { avgDays: 34, pctLate: 6 },
    accounts: { period: "Sat Dec 27", turnover: "£2,151m", profitBeforeTax: "£167.4m", netAssets: null, cash: null },
  },
};
const privateCo = {
  companies_house_number: "04611064",
  last_accounts_storage_key: "saved.pdf",
  companies_house_data: { profile: { companyType: "ltd", companyName: "COOK TRADING LIMITED" }, pscs: [{}] },
};

test("a plc with officers held is not shown an unticked Officers + PSCs", () => {
  assert.equal(isPlcRecord(plc), true);
  assert.equal(servingDirectors(plc), 2);
  const rows = recordCheckRows(plc);
  assert.deepEqual(rows.map(row => [row.key, row.done]), [["ch", true], ["psc", true], ["accounts", true], ["annual_report", true]]);
  assert.match(rows[1].label, /^Officers \+ PSCs/);
  assert.match(rows[1].note || "", /2 serving directors · public company, no PSCs on the register/);
  assert.equal(rows[3].label, "Annual report and accounts");
  assert.equal(rows[3].note, "as filed at Companies House");
});

test("the rows never tick on records that are not held", () => {
  const bare = { ...plc, last_accounts_storage_key: null, companies_house_data: { profile: { companyType: "plc" }, pscs: [] } };
  assert.deepEqual(recordCheckRows(bare).map(row => [row.key, row.done]), [["ch", true], ["psc", false], ["accounts", false], ["annual_report", false]]);
  // A private company whose PSC register was never read: no officers alone does not tick it.
  const unread = { companies_house_number: "1", companies_house_data: { profile: { companyType: "ltd" }, officers: [{ officerRole: "director" }], pscs: [] } };
  assert.equal(recordCheckRows(unread)[1].done, false);
  // Read and empty: ticked, and it says so.
  const read = { ...unread, companies_house_data: { ...unread.companies_house_data, fetchStatus: { pscs: "ok" } } };
  assert.equal(recordCheckRows(read)[1].done, true);
  assert.match(recordCheckRows(read)[1].note || "", /no PSCs on the register/);
  // A failed read of the register is not an empty register.
  const failed = { ...unread, companies_house_data: { ...unread.companies_house_data, fetchStatus: { pscs: "error" } } };
  assert.equal(recordCheckRows(failed)[1].done, false);
  assert.equal(recordCheckRows({}).some(row => row.done), false);
});

test("the annual report row is drawn only where it applies", () => {
  assert.deepEqual(recordCheckRows(privateCo).map(row => row.key), ["ch", "psc", "accounts"]);
  const stored = recordCheckRows({ ...privateCo, annual_report_storage_key: "report.pdf" });
  assert.deepEqual(stored[3], { key: "annual_report", label: "Annual report (PLC)", done: true, note: undefined });
  // The landlord card keeps its own row: always drawn, ticked only by the stored report.
  assert.deepEqual(recordCheckRows(privateCo, true).map(row => [row.key, row.done]).at(-1), ["annual_report", false]);
  assert.deepEqual(recordCheckRows(plc, true).at(-1), { key: "annual_report", label: "Annual report (PLC)", done: false, note: undefined });
});

test("the collapsed card's lines for a plc, with figures from the covenant report", () => {
  const { summary } = companyFacts(plc, report);
  assert.deepEqual(summary.map(line => line.text), [
    "Public limited company · Incorporated 1951",
    "Year to 27 Dec 2025: turnover £2,151m · profit before tax £167.4m",
    "Accounts and confirmation statement up to date",
  ]);
  assert.equal(summary.some(line => line.warn), false);
});

test("the stored period text is never printed, and a period that names another day claims no date", () => {
  const all = JSON.stringify(companyFacts(plc, report));
  assert.doesNotMatch(all, /Sat Dec 27/);
  const other = { signals: { ...report.signals, accounts: { ...report.signals.accounts, period: "Tue Mar 31" } } };
  assert.equal(companyFacts(plc, other).summary[1].text, "Latest filed accounts: turnover £2,151m · profit before tax £167.4m");
  const iso = { signals: { ...report.signals, accounts: { ...report.signals.accounts, period: "2024-12-28" } } };
  assert.match(companyFacts(plc, iso).summary[1].text, /^Year to 28 Dec 2024:/);
});

test("the full list holds only what is held", () => {
  const rows = Object.fromEntries(companyFacts(plc, report).rows.map(row => [row.key, row.value]));
  assert.deepEqual(rows, {
    type: "Public limited company", status: "Active", incorporated: "29 Dec 1951",
    office: "Greggs House, Quorum Business Park, Newcastle Upon Tyne, NE12 8BU", sic: "10710, 47240",
    period: "27 Dec 2025", turnover: "£2,151m", profit: "£167.4m",
    accounts_due: "30 Jun 2027", confirmation: "Up to date", charges: "None", insolvency: "None recorded",
    gazette: "None found", directors: "2", payment: "34 days on average · 6% paid late",
  });
  // No officers held on the record: the report's count stands.
  const noOfficers = { ...plc, companies_house_data: { ...plc.companies_house_data, officers: [] } };
  assert.equal(companyFacts(noOfficers, report).rows.find(row => row.key === "directors")?.value, "8");
  // No report (a login that is not sent one): the register facts only, no figures invented.
  const bare = Object.fromEntries(companyFacts(plc, null).rows.map(row => [row.key, row.value]));
  assert.deepEqual(Object.keys(bare), ["type", "status", "incorporated", "office", "sic", "period", "accounts_due", "confirmation", "charges", "insolvency", "directors"]);
  assert.equal(bare.directors, "2");
  assert.equal(bare.accounts_due, "Up to date");
  assert.deepEqual(companyFacts({}, null), { summary: [], rows: [] });
});

test("a ticker, an overdue filing and a company that is not active are said plainly", () => {
  const late = { ...plc, stock_ticker: "LSE: GRG", companies_house_data: { ...plc.companies_house_data, profile: { ...plc.companies_house_data.profile, companyStatus: "liquidation", confirmationStatementOverdue: true } } };
  const { summary, rows } = companyFacts(late, { signals: { ...report.signals, accountsOverdue: true } });
  assert.match(summary[0].text, /^Public limited company · Incorporated 1951 · Listed GRG\.L · Liquidation$/);
  assert.equal(summary[0].warn, true);
  assert.deepEqual(summary.at(-1), { key: "filing", text: "Accounts and confirmation statement overdue at Companies House", warn: true });
  assert.equal(rows.find(row => row.key === "accounts_due")?.warn, true);
  assert.equal(rows.find(row => row.key === "listed")?.value, "GRG.L");
});

test("the company's own read of its accounts is used when the report has no figures", () => {
  const own = { ...plc, companies_house_data: { ...plc.companies_house_data, latestAccountsExtracted: { period: "2025-12-27", turnover: "£84.2m", profitBeforeTax: "£3.1m", netAssets: "£12m", cash: "£4m", employees: "1,200" } } };
  const { summary, rows } = companyFacts(own, { signals: {} });
  assert.equal(summary[1].text, "Year to 27 Dec 2025: turnover £84.2m · profit before tax £3.1m");
  assert.equal(rows.find(row => row.key === "employees")?.value, "1,200");
  assert.equal(rows.find(row => row.key === "net_assets")?.value, "£12m");
});
