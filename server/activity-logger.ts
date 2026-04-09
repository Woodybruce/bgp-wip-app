import { db } from "./db";
import { systemActivityLog } from "@shared/schema";

export async function logActivity(source: string, action: string, detail: string, count = 1) {
  try {
    await db.insert(systemActivityLog).values({ source, action, detail, count });
  } catch (err: any) {
    console.error(`[activity-logger] Failed to log: ${err.message}`);
  }
}
