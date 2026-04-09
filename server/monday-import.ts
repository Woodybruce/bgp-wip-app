import type { Express } from "express";
import { requireAuth } from "./auth";
import { db } from "./db";
import {
  crmCompanies, crmContacts, crmProperties, crmDeals,
  crmRequirementsLeasing, crmRequirementsInvestment,
  crmComps, crmLeads,
  crmPropertyTenants, crmPropertyLeads, crmDealLeads,
  crmReqInvestProperties, crmReqInvestDeals,
  crmContactProperties, crmContactRequirements,
  crmCompanyProperties, crmCompanyDeals,
} from "@shared/schema";

const MONDAY_API_URL = "https://api.monday.com/v2";
const BOARDS = {
  properties: "5090914632",
  deals: "5090914630",
  requirementsLeasing: "5091242787",
  requirementsInvestment: "5092572124",
  companies: "5090914628",
  contacts: "5090914633",
  comps: "5091242058",
  leads: "5090914625",
};

async function mondayQuery(query: string): Promise<any> {
  const token = process.env.MONDAY_API_TOKEN;
  if (!token) throw new Error("MONDAY_API_TOKEN not set");
  const res = await fetch(MONDAY_API_URL, {
    method: "POST",
    headers: { "Authorization": token, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const data = await res.json();
  if (data.errors) throw new Error(JSON.stringify(data.errors));
  return data.data;
}

async function fetchAllItems(boardId: string): Promise<any[]> {
  const allItems: any[] = [];
  let cursor: string | null = null;
  let hasMore = true;

  const firstQuery = `{
    boards(ids: [${boardId}]) {
      items_page(limit: 200) {
        cursor
        items {
          id name group { id title }
          column_values { id type text value }
        }
      }
    }
  }`;
  const firstData = await mondayQuery(firstQuery);
  const firstPage = firstData.boards[0].items_page;
  allItems.push(...firstPage.items);
  cursor = firstPage.cursor;

  while (cursor) {
    const nextQuery = `{
      next_items_page(cursor: "${cursor}", limit: 200) {
        cursor
        items {
          id name group { id title }
          column_values { id type text value }
        }
      }
    }`;
    const nextData = await mondayQuery(nextQuery);
    const nextPage = nextData.next_items_page;
    allItems.push(...nextPage.items);
    cursor = nextPage.cursor;
  }

  return allItems;
}

function getColText(item: any, colId: string): string | null {
  const col = item.column_values?.find((c: any) => c.id === colId);
  if (!col?.text) return null;
  const t = col.text.trim();
  if (!t || t.toLowerCase() === "null") return null;
  return t;
}

function getColValue(item: any, colId: string): any {
  const col = item.column_values?.find((c: any) => c.id === colId);
  if (!col?.value) return null;
  try { return JSON.parse(col.value); } catch { return null; }
}

function getRelationIds(item: any, colId: string): string[] {
  const val = getColValue(item, colId);
  if (!val) return [];
  if (val.linkedPulseIds) return val.linkedPulseIds.map((lp: any) => String(lp.linkedPulseId));
  return [];
}

function getLocation(item: any, colId: string): any {
  const val = getColValue(item, colId);
  if (!val) return null;
  return { lat: val.lat, lng: val.lng, address: val.address || getColText(item, colId) };
}

function getNumeric(item: any, colId: string): number | null {
  const text = getColText(item, colId);
  if (!text) return null;
  const n = parseFloat(text.replace(/[^0-9.-]/g, ""));
  return isNaN(n) ? null : n;
}

function getPeopleText(item: any, colId: string): string | null {
  return getColText(item, colId);
}

async function importAll() {
  const log: string[] = [];
  const mondayToLocal: Record<string, string> = {};

  log.push("Fetching all boards from Monday.com...");

  const [companyItems, contactItems, propertyItems, dealItems, reqLeasingItems, reqInvestItems, compItems, leadItems] = await Promise.all([
    fetchAllItems(BOARDS.companies),
    fetchAllItems(BOARDS.contacts),
    fetchAllItems(BOARDS.properties),
    fetchAllItems(BOARDS.deals),
    fetchAllItems(BOARDS.requirementsLeasing),
    fetchAllItems(BOARDS.requirementsInvestment),
    fetchAllItems(BOARDS.comps),
    fetchAllItems(BOARDS.leads),
  ]);

  log.push(`Fetched: ${companyItems.length} companies, ${contactItems.length} contacts, ${propertyItems.length} properties, ${dealItems.length} deals, ${reqLeasingItems.length} req leasing, ${reqInvestItems.length} req investment, ${compItems.length} comps, ${leadItems.length} leads`);

  await Promise.all([
    db.delete(crmCompanyDeals), db.delete(crmCompanyProperties),
    db.delete(crmContactProperties), db.delete(crmContactRequirements),
    db.delete(crmPropertyTenants), db.delete(crmPropertyLeads),
    db.delete(crmDealLeads),
    db.delete(crmReqInvestProperties), db.delete(crmReqInvestDeals),
  ]);
  await Promise.all([
    db.delete(crmDeals), db.delete(crmComps), db.delete(crmLeads),
    db.delete(crmRequirementsLeasing), db.delete(crmRequirementsInvestment),
  ]);
  await db.delete(crmProperties);
  await db.delete(crmContacts);
  await db.delete(crmCompanies);

  log.push("Cleared existing CRM data");

  for (const item of companyItems) {
    const [created] = await db.insert(crmCompanies).values({
      name: item.name,
      mondayItemId: String(item.id),
      groupName: item.group?.title || null,
      domain: getColText(item, "link_mm13wwbg") || getColText(item, "name"),
      domainUrl: (() => { const v = getColValue(item, "link_mm13wwbg"); return v?.url || null; })(),
      companyType: getColText(item, "color_mm02g390"),
      description: getColText(item, "company_description"),
      headOfficeAddress: getLocation(item, "location_mm1322qf"),
      companyProfileUrl: (() => { const v = getColValue(item, "company_profile"); return v?.url || null; })(),
      bgpContactCrm: getPeopleText(item, "multiple_person_mm13f4cx"),
    }).returning();
    mondayToLocal[String(item.id)] = created.id;
  }
  log.push(`Imported ${companyItems.length} companies`);

  for (const item of contactItems) {
    const companyRelIds = getRelationIds(item, "contact_account");
    const companyId = companyRelIds.length > 0 ? mondayToLocal[companyRelIds[0]] || null : null;
    const [created] = await db.insert(crmContacts).values({
      name: item.name,
      mondayItemId: String(item.id),
      groupName: item.group?.title || null,
      role: getColText(item, "dropdown_mm083554"),
      companyId,
      companyName: getColText(item, "text_mm15hddd"),
      email: getColText(item, "contact_email"),
      bgpAllocation: getColText(item, "dropdown_mm139mpm") || null,
      contactType: getColText(item, "dropdown_mm13zc2n"),
      phone: getColText(item, "contact_phone"),
      nextMeetingDate: getColText(item, "date_mkr5a8zg"),
      notes: getColText(item, "long_text4"),
    }).returning();
    mondayToLocal[String(item.id)] = created.id;
  }
  log.push(`Imported ${contactItems.length} contacts`);

  for (const item of leadItems) {
    const [created] = await db.insert(crmLeads).values({
      name: item.name,
      mondayItemId: String(item.id),
      groupName: item.group?.title || null,
      assignedTo: getPeopleText(item, "multiple_person_mm083c92"),
      status: getColText(item, "lead_status"),
      leadType: getColText(item, "dropdown_mm08wggd"),
      source: getColText(item, "dropdown_mm08p7kx"),
      email: getColText(item, "lead_email"),
      phone: getColText(item, "lead_phone"),
      dateAdded: getColText(item, "date_mm08qehp"),
      address: getLocation(item, "location"),
      lastInteraction: getColText(item, "date__1"),
      notes: getColText(item, "long_text"),
    }).returning();
    mondayToLocal[String(item.id)] = created.id;
  }
  log.push(`Imported ${leadItems.length} leads`);

  for (const item of propertyItems) {
    const landlordRelIds = getRelationIds(item, "board_relation_mm13n8d3");
    const landlordId = landlordRelIds.length > 0 ? mondayToLocal[landlordRelIds[0]] || null : null;
    const [created] = await db.insert(crmProperties).values({
      name: item.name,
      mondayItemId: String(item.id),
      groupName: item.group?.title || null,
      agent: getPeopleText(item, "person"),
      landlordId,
      status: getColText(item, "color_mm0811tq"),
      address: getLocation(item, "location_mkr6dqmj"),
      bgpEngagement: getColText(item, "dropdown_mm0875ds") ? [getColText(item, "dropdown_mm0875ds")!] : null,
      assetClass: getColText(item, "dropdown_mm0wrm6q"),
      tenure: getColText(item, "dropdown_mm08qwaz"),
      sqft: getNumeric(item, "numeric_mkr6wmwd"),
      notes: getColText(item, "text_mkr6zksz"),
    }).returning();
    mondayToLocal[String(item.id)] = created.id;

    const tenantIds = getRelationIds(item, "board_relation_mm081rq2");
    for (const tid of tenantIds) {
      const localCompanyId = mondayToLocal[tid];
      if (localCompanyId) {
        await db.insert(crmPropertyTenants).values({ propertyId: created.id, companyId: localCompanyId }).catch(() => {});
      }
    }

    const leadRelIds = getRelationIds(item, "board_relation_mm084qke");
    for (const lid of leadRelIds) {
      const localLeadId = mondayToLocal[lid];
      if (localLeadId) {
        await db.insert(crmPropertyLeads).values({ propertyId: created.id, leadId: localLeadId }).catch(() => {});
      }
    }
  }
  log.push(`Imported ${propertyItems.length} properties`);

  for (const item of dealItems) {
    const propertyRelIds = getRelationIds(item, "board_relation_mkrbdsjq");
    const propertyId = propertyRelIds.length > 0 ? mondayToLocal[propertyRelIds[0]] || null : null;
    const landlordRelIds = getRelationIds(item, "board_relation_mm13tg9k");
    const landlordId = landlordRelIds.length > 0 ? mondayToLocal[landlordRelIds[0]] || null : null;
    const tenantRelIds = getRelationIds(item, "board_relation_mm08p13n");
    const tenantId = tenantRelIds.length > 0 ? mondayToLocal[tenantRelIds[0]] || null : null;
    const vendorRelIds = getRelationIds(item, "board_relation_mm08bq12");
    const vendorId = vendorRelIds.length > 0 ? mondayToLocal[vendorRelIds[0]] || null : null;
    const purchaserRelIds = getRelationIds(item, "board_relation_mm08ywqc");
    const purchaserId = purchaserRelIds.length > 0 ? mondayToLocal[purchaserRelIds[0]] || null : null;

    const clientContactRelIds = getRelationIds(item, "board_relation_mm08n5n0");
    const clientContactId = clientContactRelIds.length > 0 ? mondayToLocal[clientContactRelIds[0]] || null : null;
    const vendorAgentRelIds = getRelationIds(item, "board_relation_mm08q7mg");
    const vendorAgentId = vendorAgentRelIds.length > 0 ? mondayToLocal[vendorAgentRelIds[0]] || null : null;
    const acquisitionAgentRelIds = getRelationIds(item, "board_relation_mm0fnf0c");
    const acquisitionAgentId = acquisitionAgentRelIds.length > 0 ? mondayToLocal[acquisitionAgentRelIds[0]] || null : null;
    const purchaserAgentRelIds = getRelationIds(item, "board_relation_mm08tckx");
    const purchaserAgentId = purchaserAgentRelIds.length > 0 ? mondayToLocal[purchaserAgentRelIds[0]] || null : null;
    const leasingAgentRelIds = getRelationIds(item, "board_relation_mm0fh8jc");
    const leasingAgentId = leasingAgentRelIds.length > 0 ? mondayToLocal[leasingAgentRelIds[0]] || null : null;

    const timeline = getColValue(item, "timerange_mm08v3yd");

    const [created] = await db.insert(crmDeals).values({
      name: item.name,
      mondayItemId: String(item.id),
      groupName: item.group?.title || null,
      propertyId,
      landlordId,
      dealType: getColText(item, "dropdown_mm08zsxz"),
      status: getColText(item, "color_mkrb5qn7"),
      team: getColText(item, "dropdown_mm08xayc"),
      internalAgent: getPeopleText(item, "deal_owner"),
      tenantId,
      clientContactId,
      vendorId,
      purchaserId,
      vendorAgentId,
      acquisitionAgentId,
      purchaserAgentId,
      leasingAgentId,
      timelineStart: timeline?.from || null,
      timelineEnd: timeline?.to || null,
      pricing: getNumeric(item, "numeric_mm08azen"),
      yieldPercent: getNumeric(item, "numeric_mm08vs5d"),
      feeAgreement: getColText(item, "color_mm0gk1sh"),
      fee: getNumeric(item, "numeric_mm08kdnr"),
      amlCheckCompleted: getColText(item, "color_mm13bs55"),
      totalAreaSqft: getNumeric(item, "numeric_mm13s125"),
      basementAreaSqft: getNumeric(item, "numeric_mm0g6v03"),
      gfAreaSqft: getNumeric(item, "numeric_mm081jbq"),
      ffAreaSqft: getNumeric(item, "numeric_mm0grz2w"),
      itzaAreaSqft: getNumeric(item, "numeric_mm0gtxmh"),
      pricePsf: getNumeric(item, "numeric_mm087rbt"),
      priceItza: getNumeric(item, "numeric_mm0ffvz6"),
      rentPa: getNumeric(item, "numeric_mm084qrt"),
      capitalContribution: getNumeric(item, "numeric_mm1323x1"),
      rentFree: getNumeric(item, "numeric_mm0gp5jg"),
      leaseLength: getNumeric(item, "numeric_mm13x9pt"),
      breakOption: getNumeric(item, "numeric_mm13fn80"),
      completionDate: getColText(item, "date_mm13c5rs"),
      rentAnalysis: getNumeric(item, "numeric_mm0g5qzn"),
      comments: getColText(item, "long_text_mm08403y"),
      lastInteraction: getColText(item, "date__1"),
      sharepointLink: (() => { const v = getColValue(item, "link_mm089apv"); return v?.url || null; })(),
      tenureText: getColText(item, "text_mm15a4tf"),
      assetClass: getColText(item, "dropdown_mm15vfd2"),
    }).returning();
    mondayToLocal[String(item.id)] = created.id;

    const dealLeadIds = getRelationIds(item, "board_relation_mm084nr3");
    for (const lid of dealLeadIds) {
      const localLeadId = mondayToLocal[lid];
      if (localLeadId) {
        await db.insert(crmDealLeads).values({ dealId: created.id, leadId: localLeadId }).catch(() => {});
      }
    }
  }
  log.push(`Imported ${dealItems.length} deals`);

  for (const item of reqLeasingItems) {
    const companyRelIds = getRelationIds(item, "board_relation_mm128vm1");
    const companyId = companyRelIds.length > 0 ? mondayToLocal[companyRelIds[0]] || null : null;
    const principalContactRelIds = getRelationIds(item, "board_relation_mm08hjva");
    const principalContactId = principalContactRelIds.length > 0 ? mondayToLocal[principalContactRelIds[0]] || null : null;
    const agentContactRelIds = getRelationIds(item, "board_relation_mm13gc2x");
    const agentContactId = agentContactRelIds.length > 0 ? mondayToLocal[agentContactRelIds[0]] || null : null;

    const [created] = await db.insert(crmRequirementsLeasing).values({
      name: item.name,
      mondayItemId: String(item.id),
      groupName: item.group?.title || null,
      status: getColText(item, "color_mm134nmh"),
      companyId,
      use: getColText(item, "dropdown_mm08qw0d")?.split(",").map((s: string) => s.trim()).filter(Boolean) || null,
      requirementType: getColText(item, "dropdown_mm0hh91y")?.split(",").map((s: string) => s.trim()).filter(Boolean) || null,
      size: getColText(item, "dropdown_mm0h9p2m")?.split(",").map((s: string) => s.trim()).filter(Boolean) || null,
      requirementLocations: getColText(item, "dropdown_mm13bn82")?.split(",").map((s: string) => s.trim()).filter(Boolean) || null,
      principalContactId,
      agentContactId,
      extract: getColText(item, "dropdown_mm0h4z6d"),
      comments: getColText(item, "text_mm13jbnv"),
    }).returning();
    mondayToLocal[String(item.id)] = created.id;
  }
  log.push(`Imported ${reqLeasingItems.length} requirements leasing`);

  for (const item of reqInvestItems) {
    const companyRelIds = getRelationIds(item, "board_relation_mm1294ds");
    const companyId = companyRelIds.length > 0 ? mondayToLocal[companyRelIds[0]] || null : null;
    const contactRelIds = getRelationIds(item, "board_relation_mm08hjva");
    const contactId = contactRelIds.length > 0 ? mondayToLocal[contactRelIds[0]] || null : null;

    const [created] = await db.insert(crmRequirementsInvestment).values({
      name: item.name,
      mondayItemId: String(item.id),
      groupName: item.group?.title || null,
      companyId,
      locations: getColText(item, "long_text_mm08yyt8"),
      use: getColText(item, "dropdown_mm08qw0d"),
      location: getLocation(item, "location_mm0hd2p"),
      requirementType: getColText(item, "dropdown_mm0hh91y"),
      size: getColText(item, "dropdown_mm0h9p2m"),
      contactId,
      extract: getColText(item, "dropdown_mm0h4z6d"),
    }).returning();
    mondayToLocal[String(item.id)] = created.id;

    const propRelIds = getRelationIds(item, "board_relation_mm08y93r");
    for (const pid of propRelIds) {
      const localPropId = mondayToLocal[pid];
      if (localPropId) {
        await db.insert(crmReqInvestProperties).values({ requirementId: created.id, propertyId: localPropId }).catch(() => {});
      }
    }
    const dealRelIds = getRelationIds(item, "board_relation_mm08gmct");
    for (const did of dealRelIds) {
      const localDealId = mondayToLocal[did];
      if (localDealId) {
        await db.insert(crmReqInvestDeals).values({ requirementId: created.id, dealId: localDealId }).catch(() => {});
      }
    }
  }
  log.push(`Imported ${reqInvestItems.length} requirements investment`);

  for (const item of compItems) {
    const propertyRelIds = getRelationIds(item, "board_relation_mm08btc3");
    const propertyId = propertyRelIds.length > 0 ? mondayToLocal[propertyRelIds[0]] || null : null;

    const [created] = await db.insert(crmComps).values({
      name: item.name,
      mondayItemId: String(item.id),
      groupName: item.group?.title || null,
      propertyId,
      dealType: getColText(item, "dropdown_mm0nvm41"),
      address: getLocation(item, "location_mm13a8pv"),
      tenant: getColText(item, "text_mm083krk"),
      landlord: getColText(item, "text_mm08q1gk"),
      transaction: getColText(item, "text_mm084zkh"),
      term: getColText(item, "text_mm08hrd2"),
      demise: getColText(item, "text_mm0845xb"),
      areaSqft: getColText(item, "text_mm08jgyq"),
      headlineRent: getColText(item, "text_mm08xg38"),
      zoneARate: getColText(item, "text_mm08qaw2"),
      overallRate: getColText(item, "text_mm08jnq5"),
      rentFree: getColText(item, "text_mm086m9r"),
      capex: getColText(item, "text_mm08kqgr"),
      rentAnalysis: getColText(item, "text_mm08hasv"),
      comments: getColText(item, "text_mm08w8mc"),
    }).returning();
    mondayToLocal[String(item.id)] = created.id;
  }
  log.push(`Imported ${compItems.length} comps`);

  for (const item of contactItems) {
    const localContactId = mondayToLocal[String(item.id)];
    if (!localContactId) continue;

    const propRelIds = getRelationIds(item, "board_relation_mkr5wd3b");
    for (const pid of propRelIds) {
      const localPropId = mondayToLocal[pid];
      if (localPropId) {
        await db.insert(crmContactProperties).values({ contactId: localContactId, propertyId: localPropId }).catch(() => {});
      }
    }
    const reqRelIds = getRelationIds(item, "board_relation_mm08b2g9");
    for (const rid of reqRelIds) {
      const localReqId = mondayToLocal[rid];
      if (localReqId) {
        await db.insert(crmContactRequirements).values({ contactId: localContactId, requirementId: localReqId }).catch(() => {});
      }
    }
  }

  for (const item of companyItems) {
    const localCompanyId = mondayToLocal[String(item.id)];
    if (!localCompanyId) continue;

    const propRelIds = getRelationIds(item, "board_relation_mm1390cr");
    for (const pid of propRelIds) {
      const localPropId = mondayToLocal[pid];
      if (localPropId) {
        await db.insert(crmCompanyProperties).values({ companyId: localCompanyId, propertyId: localPropId }).catch(() => {});
      }
    }
    const dealRelIds = getRelationIds(item, "board_relation_mm132vav");
    for (const did of dealRelIds) {
      const localDealId = mondayToLocal[did];
      if (localDealId) {
        await db.insert(crmCompanyDeals).values({ companyId: localCompanyId, dealId: localDealId }).catch(() => {});
      }
    }
  }

  log.push("Relationship linking complete");
  log.push("Import finished successfully!");

  return { log, counts: {
    companies: companyItems.length, contacts: contactItems.length,
    properties: propertyItems.length, deals: dealItems.length,
    requirementsLeasing: reqLeasingItems.length, requirementsInvestment: reqInvestItems.length,
    comps: compItems.length, leads: leadItems.length,
  }};
}

export function setupMondayImportRoutes(app: Express) {
  app.post("/api/crm/import", requireAuth, async (_req, res) => {
    try {
      const result = await importAll();
      res.json(result);
    } catch (e: any) {
      console.error("Import error:", e);
      res.status(500).json({ error: e.message });
    }
  });
}
