import { db } from "./db";
import { crmRequirementsInvestment } from "../shared/schema";
import { sql } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";

export async function seedInvestmentRequirements() {
  const seedPath = path.join(process.cwd(), "data", "invest-reqs-seed.json");
  if (!fs.existsSync(seedPath)) {
    return;
  }

  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(crmRequirementsInvestment);
  if (count >= 50) {
    return;
  }

  console.log(`[seed] Investment requirements: ${count} found, seeding from file...`);
  const items = JSON.parse(fs.readFileSync(seedPath, "utf8"));
  let inserted = 0;

  for (const item of items) {
    try {
      await db.insert(crmRequirementsInvestment).values({
        id: item.id,
        name: item.name || "Unknown",
        mondayItemId: item.mondayItemId,
        groupName: item.groupName,
        status: item.status,
        companyId: item.companyId,
        use: item.use,
        requirementType: item.requirementType,
        size: item.size,
        requirementLocations: item.requirementLocations,
        locationData: item.locationData,
        locations: item.locations,
        location: item.location,
        principalContactId: item.principalContactId,
        agentContactId: item.agentContactId,
        contactId: item.contactId,
        contactName: item.contactName,
        contactEmail: item.contactEmail,
        contactMobile: item.contactMobile,
        dealId: item.dealId,
        landlordPack: item.landlordPack,
        extract: item.extract,
        comments: item.comments,
        requirementDate: item.requirementDate,
        contacted: item.contacted ?? false,
        detailsSent: item.detailsSent ?? false,
        viewing: item.viewing ?? false,
        shortlisted: item.shortlisted ?? false,
        underOffer: item.underOffer ?? false,
      }).onConflictDoNothing();
      inserted++;
    } catch (err: any) {
      // skip duplicates silently
    }
  }

  console.log(`[seed] Investment requirements: inserted ${inserted} of ${items.length}`);
}
