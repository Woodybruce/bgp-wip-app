// Seed for the Finance Cashflow board — parsed once from Woody's
// "Cashflow_Forecast__BGP_2026__2027.xlsx" (dropped 2026-08-27). Input
// lines only: totals, opening-balance chain and closing balances are
// computed from these rows, never stored. Amounts are pounds as in the
// workbook; receipts positive, payments negative. Used only when the
// cashflow tables are empty — after that the board's own data wins.
export const CASHFLOW_SEED: {
  months: string[];
  lines: Array<{ key: string; label: string; section: "receipts" | "payments" | "balance"; sort: number }>;
  cells: Array<{ lineKey: string; lineLabel: string; month: string; basis: "budget" | "actual"; amount: number }>;
} = {
  "months": [
    "2026-07",
    "2026-08",
    "2026-09",
    "2026-10",
    "2026-11",
    "2026-12",
    "2027-01",
    "2027-02",
    "2027-03",
    "2027-04"
  ],
  "lines": [
    {
      "key": "1",
      "label": "Sales (inc VAT) - received/cleared",
      "section": "receipts",
      "sort": 10
    },
    {
      "key": "2",
      "label": "Sales (incl. VAT) - invoiced & expected",
      "section": "receipts",
      "sort": 20
    },
    {
      "key": "3",
      "label": "Sales (incl. VAT) - invoiced and older than 60 days",
      "section": "receipts",
      "sort": 30
    },
    {
      "key": "4a",
      "label": "WIP sales (incl. VAT) Draft Invoices",
      "section": "receipts",
      "sort": 40
    },
    {
      "key": "4c",
      "label": "WIP sales (incl. VAT) August 2026 onwards",
      "section": "receipts",
      "sort": 50
    },
    {
      "key": "5",
      "label": "Investment Received",
      "section": "receipts",
      "sort": 60
    },
    {
      "key": "6",
      "label": "Direct Debits",
      "section": "payments",
      "sort": 70
    },
    {
      "key": "7",
      "label": "Suppliers incl. Expenses",
      "section": "payments",
      "sort": 80
    },
    {
      "key": "8",
      "label": "Net Wages / Salaries",
      "section": "payments",
      "sort": 90
    },
    {
      "key": "9",
      "label": "Commission & Bonus GROSS incl. NIC",
      "section": "payments",
      "sort": 100
    },
    {
      "key": "10",
      "label": "Pensions",
      "section": "payments",
      "sort": 110
    },
    {
      "key": "11",
      "label": "PAYE / NI",
      "section": "payments",
      "sort": 120
    },
    {
      "key": "12",
      "label": "Rent  - 55 Wells Street",
      "section": "payments",
      "sort": 130
    },
    {
      "key": "13",
      "label": "Service Fees - 55 Wells - 50% + 5% costs",
      "section": "payments",
      "sort": 140
    },
    {
      "key": "14",
      "label": "Rates - 55 Wells Street - 50% + 5% costs",
      "section": "payments",
      "sort": 150
    },
    {
      "key": "15",
      "label": "Building & Risk Insurance - 50% + 5% costs",
      "section": "payments",
      "sort": 160
    },
    {
      "key": "16",
      "label": "Siemens - 50% + 5% costs",
      "section": "payments",
      "sort": 170
    },
    {
      "key": "17",
      "label": "127Solutions - 50% + 5% costs",
      "section": "payments",
      "sort": 180
    },
    {
      "key": "18",
      "label": "Cleaning",
      "section": "payments",
      "sort": 190
    },
    {
      "key": "19",
      "label": "Electricity",
      "section": "payments",
      "sort": 200
    },
    {
      "key": "20",
      "label": "Bank / Finance Charges",
      "section": "payments",
      "sort": 210
    },
    {
      "key": "21",
      "label": "Directors",
      "section": "payments",
      "sort": 220
    },
    {
      "key": "22",
      "label": "VAT",
      "section": "payments",
      "sort": 230
    },
    {
      "key": "23",
      "label": "P11d NIC",
      "section": "payments",
      "sort": 240
    },
    {
      "key": "24",
      "label": "Money Laundering Fee",
      "section": "payments",
      "sort": 250
    },
    {
      "key": "25",
      "label": "PSA",
      "section": "payments",
      "sort": 260
    },
    {
      "key": "26",
      "label": "Corporation Tax",
      "section": "payments",
      "sort": 270
    },
    {
      "key": "27",
      "label": "Transfer to Wells Street - which is then offset against rent etc",
      "section": "payments",
      "sort": 280
    },
    {
      "key": "28",
      "label": "Transfers to/from other reserve bank accounts",
      "section": "payments",
      "sort": 290
    },
    {
      "key": "OPEN",
      "label": "Opening Bank Balance",
      "section": "balance",
      "sort": 300
    },
    {
      "key": "RESERVE",
      "label": "Closing to/from other reserve bank accounts",
      "section": "balance",
      "sort": 310
    }
  ],
  "cells": [
    {
      "lineKey": "1",
      "lineLabel": "Sales (inc VAT) - received/cleared",
      "month": "2026-08",
      "basis": "actual",
      "amount": 286624.2
    },
    {
      "lineKey": "2",
      "lineLabel": "Sales (incl. VAT) - invoiced & expected",
      "month": "2026-09",
      "basis": "budget",
      "amount": 224576.26
    },
    {
      "lineKey": "3",
      "lineLabel": "Sales (incl. VAT) - invoiced and older than 60 days",
      "month": "2026-11",
      "basis": "budget",
      "amount": 263604.0
    },
    {
      "lineKey": "4a",
      "lineLabel": "WIP sales (incl. VAT) Draft Invoices",
      "month": "2026-09",
      "basis": "budget",
      "amount": 24786.0
    },
    {
      "lineKey": "4c",
      "lineLabel": "WIP sales (incl. VAT) August 2026 onwards",
      "month": "2026-10",
      "basis": "budget",
      "amount": 1301026.0
    },
    {
      "lineKey": "4c",
      "lineLabel": "WIP sales (incl. VAT) August 2026 onwards",
      "month": "2026-11",
      "basis": "budget",
      "amount": 633475.2
    },
    {
      "lineKey": "4c",
      "lineLabel": "WIP sales (incl. VAT) August 2026 onwards",
      "month": "2026-12",
      "basis": "budget",
      "amount": 392018.4
    },
    {
      "lineKey": "4c",
      "lineLabel": "WIP sales (incl. VAT) August 2026 onwards",
      "month": "2027-01",
      "basis": "budget",
      "amount": 420000.0
    },
    {
      "lineKey": "4c",
      "lineLabel": "WIP sales (incl. VAT) August 2026 onwards",
      "month": "2027-02",
      "basis": "budget",
      "amount": 420000.0
    },
    {
      "lineKey": "4c",
      "lineLabel": "WIP sales (incl. VAT) August 2026 onwards",
      "month": "2027-03",
      "basis": "budget",
      "amount": 420000.0
    },
    {
      "lineKey": "4c",
      "lineLabel": "WIP sales (incl. VAT) August 2026 onwards",
      "month": "2027-04",
      "basis": "budget",
      "amount": 420000.0
    },
    {
      "lineKey": "6",
      "lineLabel": "Direct Debits",
      "month": "2026-08",
      "basis": "budget",
      "amount": -5000.0
    },
    {
      "lineKey": "6",
      "lineLabel": "Direct Debits",
      "month": "2026-08",
      "basis": "actual",
      "amount": -12290.81
    },
    {
      "lineKey": "6",
      "lineLabel": "Direct Debits",
      "month": "2026-09",
      "basis": "budget",
      "amount": -25000.0
    },
    {
      "lineKey": "6",
      "lineLabel": "Direct Debits",
      "month": "2026-10",
      "basis": "budget",
      "amount": -25000.0
    },
    {
      "lineKey": "6",
      "lineLabel": "Direct Debits",
      "month": "2026-11",
      "basis": "budget",
      "amount": -25000.0
    },
    {
      "lineKey": "6",
      "lineLabel": "Direct Debits",
      "month": "2026-12",
      "basis": "budget",
      "amount": -25000.0
    },
    {
      "lineKey": "6",
      "lineLabel": "Direct Debits",
      "month": "2027-01",
      "basis": "budget",
      "amount": -25000.0
    },
    {
      "lineKey": "6",
      "lineLabel": "Direct Debits",
      "month": "2027-02",
      "basis": "budget",
      "amount": -25000.0
    },
    {
      "lineKey": "6",
      "lineLabel": "Direct Debits",
      "month": "2027-03",
      "basis": "budget",
      "amount": -25000.0
    },
    {
      "lineKey": "6",
      "lineLabel": "Direct Debits",
      "month": "2027-04",
      "basis": "budget",
      "amount": -25000.0
    },
    {
      "lineKey": "7",
      "lineLabel": "Suppliers incl. Expenses",
      "month": "2026-08",
      "basis": "budget",
      "amount": -10000.0
    },
    {
      "lineKey": "7",
      "lineLabel": "Suppliers incl. Expenses",
      "month": "2026-08",
      "basis": "actual",
      "amount": -51424.8
    },
    {
      "lineKey": "7",
      "lineLabel": "Suppliers incl. Expenses",
      "month": "2026-09",
      "basis": "budget",
      "amount": -50000.0
    },
    {
      "lineKey": "7",
      "lineLabel": "Suppliers incl. Expenses",
      "month": "2026-10",
      "basis": "budget",
      "amount": -50000.0
    },
    {
      "lineKey": "7",
      "lineLabel": "Suppliers incl. Expenses",
      "month": "2026-11",
      "basis": "budget",
      "amount": -50000.0
    },
    {
      "lineKey": "7",
      "lineLabel": "Suppliers incl. Expenses",
      "month": "2026-12",
      "basis": "budget",
      "amount": -50000.0
    },
    {
      "lineKey": "7",
      "lineLabel": "Suppliers incl. Expenses",
      "month": "2027-01",
      "basis": "budget",
      "amount": -50000.0
    },
    {
      "lineKey": "7",
      "lineLabel": "Suppliers incl. Expenses",
      "month": "2027-02",
      "basis": "budget",
      "amount": -50000.0
    },
    {
      "lineKey": "7",
      "lineLabel": "Suppliers incl. Expenses",
      "month": "2027-03",
      "basis": "budget",
      "amount": -50000.0
    },
    {
      "lineKey": "7",
      "lineLabel": "Suppliers incl. Expenses",
      "month": "2027-04",
      "basis": "budget",
      "amount": -50000.0
    },
    {
      "lineKey": "8",
      "lineLabel": "Net Wages / Salaries",
      "month": "2026-08",
      "basis": "actual",
      "amount": -102374.14
    },
    {
      "lineKey": "8",
      "lineLabel": "Net Wages / Salaries",
      "month": "2026-09",
      "basis": "budget",
      "amount": -125000.0
    },
    {
      "lineKey": "8",
      "lineLabel": "Net Wages / Salaries",
      "month": "2026-10",
      "basis": "budget",
      "amount": -125000.0
    },
    {
      "lineKey": "8",
      "lineLabel": "Net Wages / Salaries",
      "month": "2026-11",
      "basis": "budget",
      "amount": -125000.0
    },
    {
      "lineKey": "8",
      "lineLabel": "Net Wages / Salaries",
      "month": "2026-12",
      "basis": "budget",
      "amount": -125000.0
    },
    {
      "lineKey": "8",
      "lineLabel": "Net Wages / Salaries",
      "month": "2027-01",
      "basis": "budget",
      "amount": -125000.0
    },
    {
      "lineKey": "8",
      "lineLabel": "Net Wages / Salaries",
      "month": "2027-02",
      "basis": "budget",
      "amount": -125000.0
    },
    {
      "lineKey": "8",
      "lineLabel": "Net Wages / Salaries",
      "month": "2027-03",
      "basis": "budget",
      "amount": -125000.0
    },
    {
      "lineKey": "8",
      "lineLabel": "Net Wages / Salaries",
      "month": "2027-04",
      "basis": "budget",
      "amount": -125000.0
    },
    {
      "lineKey": "9",
      "lineLabel": "Commission & Bonus GROSS incl. NIC",
      "month": "2026-09",
      "basis": "budget",
      "amount": -50000.0
    },
    {
      "lineKey": "9",
      "lineLabel": "Commission & Bonus GROSS incl. NIC",
      "month": "2026-10",
      "basis": "budget",
      "amount": -50000.0
    },
    {
      "lineKey": "9",
      "lineLabel": "Commission & Bonus GROSS incl. NIC",
      "month": "2026-11",
      "basis": "budget",
      "amount": -50000.0
    },
    {
      "lineKey": "9",
      "lineLabel": "Commission & Bonus GROSS incl. NIC",
      "month": "2026-12",
      "basis": "budget",
      "amount": -50000.0
    },
    {
      "lineKey": "9",
      "lineLabel": "Commission & Bonus GROSS incl. NIC",
      "month": "2027-01",
      "basis": "budget",
      "amount": -50000.0
    },
    {
      "lineKey": "9",
      "lineLabel": "Commission & Bonus GROSS incl. NIC",
      "month": "2027-02",
      "basis": "budget",
      "amount": -50000.0
    },
    {
      "lineKey": "9",
      "lineLabel": "Commission & Bonus GROSS incl. NIC",
      "month": "2027-03",
      "basis": "budget",
      "amount": -50000.0
    },
    {
      "lineKey": "9",
      "lineLabel": "Commission & Bonus GROSS incl. NIC",
      "month": "2027-04",
      "basis": "budget",
      "amount": -50000.0
    },
    {
      "lineKey": "10",
      "lineLabel": "Pensions",
      "month": "2026-08",
      "basis": "budget",
      "amount": -400.0
    },
    {
      "lineKey": "10",
      "lineLabel": "Pensions",
      "month": "2026-08",
      "basis": "actual",
      "amount": -17258.17
    },
    {
      "lineKey": "10",
      "lineLabel": "Pensions",
      "month": "2026-09",
      "basis": "budget",
      "amount": -15320.87
    },
    {
      "lineKey": "10",
      "lineLabel": "Pensions",
      "month": "2026-10",
      "basis": "budget",
      "amount": -16000.0
    },
    {
      "lineKey": "10",
      "lineLabel": "Pensions",
      "month": "2026-11",
      "basis": "budget",
      "amount": -16000.0
    },
    {
      "lineKey": "10",
      "lineLabel": "Pensions",
      "month": "2026-12",
      "basis": "budget",
      "amount": -16000.0
    },
    {
      "lineKey": "10",
      "lineLabel": "Pensions",
      "month": "2027-01",
      "basis": "budget",
      "amount": -16000.0
    },
    {
      "lineKey": "10",
      "lineLabel": "Pensions",
      "month": "2027-02",
      "basis": "budget",
      "amount": -16000.0
    },
    {
      "lineKey": "10",
      "lineLabel": "Pensions",
      "month": "2027-03",
      "basis": "budget",
      "amount": -16000.0
    },
    {
      "lineKey": "10",
      "lineLabel": "Pensions",
      "month": "2027-04",
      "basis": "budget",
      "amount": -16000.0
    },
    {
      "lineKey": "11",
      "lineLabel": "PAYE / NI",
      "month": "2026-08",
      "basis": "actual",
      "amount": -77192.17
    },
    {
      "lineKey": "11",
      "lineLabel": "PAYE / NI",
      "month": "2026-09",
      "basis": "budget",
      "amount": -71494.87
    },
    {
      "lineKey": "11",
      "lineLabel": "PAYE / NI",
      "month": "2026-10",
      "basis": "budget",
      "amount": -85000.0
    },
    {
      "lineKey": "11",
      "lineLabel": "PAYE / NI",
      "month": "2026-11",
      "basis": "budget",
      "amount": -85000.0
    },
    {
      "lineKey": "11",
      "lineLabel": "PAYE / NI",
      "month": "2026-12",
      "basis": "budget",
      "amount": -85000.0
    },
    {
      "lineKey": "11",
      "lineLabel": "PAYE / NI",
      "month": "2027-01",
      "basis": "budget",
      "amount": -85000.0
    },
    {
      "lineKey": "11",
      "lineLabel": "PAYE / NI",
      "month": "2027-02",
      "basis": "budget",
      "amount": -85000.0
    },
    {
      "lineKey": "11",
      "lineLabel": "PAYE / NI",
      "month": "2027-03",
      "basis": "budget",
      "amount": -85000.0
    },
    {
      "lineKey": "11",
      "lineLabel": "PAYE / NI",
      "month": "2027-04",
      "basis": "budget",
      "amount": -85000.0
    },
    {
      "lineKey": "12",
      "lineLabel": "Rent  - 55 Wells Street",
      "month": "2026-12",
      "basis": "budget",
      "amount": -58144.75
    },
    {
      "lineKey": "12",
      "lineLabel": "Rent  - 55 Wells Street",
      "month": "2027-03",
      "basis": "budget",
      "amount": -58144.75
    },
    {
      "lineKey": "13",
      "lineLabel": "Service Fees - 55 Wells - 50% + 5% costs",
      "month": "2026-12",
      "basis": "budget",
      "amount": -11602.87
    },
    {
      "lineKey": "13",
      "lineLabel": "Service Fees - 55 Wells - 50% + 5% costs",
      "month": "2027-03",
      "basis": "budget",
      "amount": -11602.87
    },
    {
      "lineKey": "14",
      "lineLabel": "Rates - 55 Wells Street - 50% + 5% costs",
      "month": "2026-12",
      "basis": "budget",
      "amount": -31003.88
    },
    {
      "lineKey": "14",
      "lineLabel": "Rates - 55 Wells Street - 50% + 5% costs",
      "month": "2027-03",
      "basis": "budget",
      "amount": -31003.88
    },
    {
      "lineKey": "15",
      "lineLabel": "Building & Risk Insurance - 50% + 5% costs",
      "month": "2026-12",
      "basis": "budget",
      "amount": -1289.86
    },
    {
      "lineKey": "15",
      "lineLabel": "Building & Risk Insurance - 50% + 5% costs",
      "month": "2027-03",
      "basis": "budget",
      "amount": -1289.86
    },
    {
      "lineKey": "16",
      "lineLabel": "Siemens - 50% + 5% costs",
      "month": "2026-12",
      "basis": "budget",
      "amount": -11707.87
    },
    {
      "lineKey": "16",
      "lineLabel": "Siemens - 50% + 5% costs",
      "month": "2027-03",
      "basis": "budget",
      "amount": -11707.87
    },
    {
      "lineKey": "17",
      "lineLabel": "127Solutions - 50% + 5% costs",
      "month": "2026-12",
      "basis": "budget",
      "amount": -441.0
    },
    {
      "lineKey": "17",
      "lineLabel": "127Solutions - 50% + 5% costs",
      "month": "2027-03",
      "basis": "budget",
      "amount": -441.0
    },
    {
      "lineKey": "18",
      "lineLabel": "Cleaning",
      "month": "2026-12",
      "basis": "budget",
      "amount": -8190.0
    },
    {
      "lineKey": "18",
      "lineLabel": "Cleaning",
      "month": "2027-03",
      "basis": "budget",
      "amount": -8190.0
    },
    {
      "lineKey": "19",
      "lineLabel": "Electricity",
      "month": "2026-12",
      "basis": "budget",
      "amount": -6000.0
    },
    {
      "lineKey": "19",
      "lineLabel": "Electricity",
      "month": "2027-03",
      "basis": "budget",
      "amount": -6000.0
    },
    {
      "lineKey": "20",
      "lineLabel": "Bank / Finance Charges",
      "month": "2026-08",
      "basis": "budget",
      "amount": -150.0
    },
    {
      "lineKey": "20",
      "lineLabel": "Bank / Finance Charges",
      "month": "2026-08",
      "basis": "actual",
      "amount": -95.5
    },
    {
      "lineKey": "20",
      "lineLabel": "Bank / Finance Charges",
      "month": "2026-09",
      "basis": "budget",
      "amount": -200.0
    },
    {
      "lineKey": "20",
      "lineLabel": "Bank / Finance Charges",
      "month": "2026-10",
      "basis": "budget",
      "amount": -200.0
    },
    {
      "lineKey": "20",
      "lineLabel": "Bank / Finance Charges",
      "month": "2026-11",
      "basis": "budget",
      "amount": -200.0
    },
    {
      "lineKey": "20",
      "lineLabel": "Bank / Finance Charges",
      "month": "2026-12",
      "basis": "budget",
      "amount": -200.0
    },
    {
      "lineKey": "20",
      "lineLabel": "Bank / Finance Charges",
      "month": "2027-01",
      "basis": "budget",
      "amount": -200.0
    },
    {
      "lineKey": "20",
      "lineLabel": "Bank / Finance Charges",
      "month": "2027-02",
      "basis": "budget",
      "amount": -200.0
    },
    {
      "lineKey": "20",
      "lineLabel": "Bank / Finance Charges",
      "month": "2027-03",
      "basis": "budget",
      "amount": -200.0
    },
    {
      "lineKey": "20",
      "lineLabel": "Bank / Finance Charges",
      "month": "2027-04",
      "basis": "budget",
      "amount": -200.0
    },
    {
      "lineKey": "22",
      "lineLabel": "VAT",
      "month": "2026-09",
      "basis": "budget",
      "amount": -105000.0
    },
    {
      "lineKey": "22",
      "lineLabel": "VAT",
      "month": "2026-12",
      "basis": "budget",
      "amount": -322416.87
    },
    {
      "lineKey": "22",
      "lineLabel": "VAT",
      "month": "2027-03",
      "basis": "budget",
      "amount": -205336.4
    },
    {
      "lineKey": "24",
      "lineLabel": "Money Laundering Fee",
      "month": "2027-02",
      "basis": "budget",
      "amount": -350.0
    },
    {
      "lineKey": "25",
      "lineLabel": "PSA",
      "month": "2026-10",
      "basis": "budget",
      "amount": -50000.0
    },
    {
      "lineKey": "26",
      "lineLabel": "Corporation Tax",
      "month": "2027-01",
      "basis": "budget",
      "amount": -350000.0
    },
    {
      "lineKey": "27",
      "lineLabel": "Transfer to Wells Street - which is then offset against rent etc",
      "month": "2026-08",
      "basis": "actual",
      "amount": -70000.0
    },
    {
      "lineKey": "OPEN",
      "lineLabel": "Opening Bank Balance",
      "month": "2026-07",
      "basis": "budget",
      "amount": 171666.09
    },
    {
      "lineKey": "OPEN",
      "lineLabel": "Opening Bank Balance",
      "month": "2026-07",
      "basis": "actual",
      "amount": 171666.09
    },
    {
      "lineKey": "RESERVE",
      "lineLabel": "Closing to/from other reserve bank accounts",
      "month": "2026-07",
      "basis": "budget",
      "amount": 247879.49
    },
    {
      "lineKey": "RESERVE",
      "lineLabel": "Closing to/from other reserve bank accounts",
      "month": "2026-07",
      "basis": "actual",
      "amount": 247879.49
    },
    {
      "lineKey": "RESERVE",
      "lineLabel": "Closing to/from other reserve bank accounts",
      "month": "2026-08",
      "basis": "budget",
      "amount": 248360.14
    },
    {
      "lineKey": "RESERVE",
      "lineLabel": "Closing to/from other reserve bank accounts",
      "month": "2026-08",
      "basis": "actual",
      "amount": 248360.14
    },
    {
      "lineKey": "RESERVE",
      "lineLabel": "Closing to/from other reserve bank accounts",
      "month": "2026-09",
      "basis": "budget",
      "amount": 248360.14
    },
    {
      "lineKey": "RESERVE",
      "lineLabel": "Closing to/from other reserve bank accounts",
      "month": "2026-09",
      "basis": "actual",
      "amount": 248360.14
    },
    {
      "lineKey": "RESERVE",
      "lineLabel": "Closing to/from other reserve bank accounts",
      "month": "2026-10",
      "basis": "budget",
      "amount": 248360.14
    },
    {
      "lineKey": "RESERVE",
      "lineLabel": "Closing to/from other reserve bank accounts",
      "month": "2026-10",
      "basis": "actual",
      "amount": 248360.14
    },
    {
      "lineKey": "RESERVE",
      "lineLabel": "Closing to/from other reserve bank accounts",
      "month": "2026-11",
      "basis": "budget",
      "amount": 248360.14
    },
    {
      "lineKey": "RESERVE",
      "lineLabel": "Closing to/from other reserve bank accounts",
      "month": "2026-11",
      "basis": "actual",
      "amount": 248360.14
    },
    {
      "lineKey": "RESERVE",
      "lineLabel": "Closing to/from other reserve bank accounts",
      "month": "2026-12",
      "basis": "budget",
      "amount": 248360.14
    },
    {
      "lineKey": "RESERVE",
      "lineLabel": "Closing to/from other reserve bank accounts",
      "month": "2026-12",
      "basis": "actual",
      "amount": 248360.14
    },
    {
      "lineKey": "RESERVE",
      "lineLabel": "Closing to/from other reserve bank accounts",
      "month": "2027-01",
      "basis": "budget",
      "amount": 248360.14
    },
    {
      "lineKey": "RESERVE",
      "lineLabel": "Closing to/from other reserve bank accounts",
      "month": "2027-01",
      "basis": "actual",
      "amount": 248360.14
    },
    {
      "lineKey": "RESERVE",
      "lineLabel": "Closing to/from other reserve bank accounts",
      "month": "2027-02",
      "basis": "budget",
      "amount": 248360.14
    },
    {
      "lineKey": "RESERVE",
      "lineLabel": "Closing to/from other reserve bank accounts",
      "month": "2027-02",
      "basis": "actual",
      "amount": 248360.14
    },
    {
      "lineKey": "RESERVE",
      "lineLabel": "Closing to/from other reserve bank accounts",
      "month": "2027-03",
      "basis": "budget",
      "amount": 248360.14
    },
    {
      "lineKey": "RESERVE",
      "lineLabel": "Closing to/from other reserve bank accounts",
      "month": "2027-03",
      "basis": "actual",
      "amount": 248360.14
    },
    {
      "lineKey": "RESERVE",
      "lineLabel": "Closing to/from other reserve bank accounts",
      "month": "2027-04",
      "basis": "budget",
      "amount": 248360.14
    },
    {
      "lineKey": "RESERVE",
      "lineLabel": "Closing to/from other reserve bank accounts",
      "month": "2027-04",
      "basis": "actual",
      "amount": 248360.14
    }
  ]
};
