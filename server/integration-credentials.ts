import { db } from "./db";
import { systemSettings } from "@shared/schema";
import { eq } from "drizzle-orm";

export interface PipnetCreds {
  username: string;
  email: string;
  password: string;
}

const PIPNET_KEY = "integration:pipnet";

export async function getPipnetCreds(): Promise<PipnetCreds> {
  try {
    const rows = await db.select().from(systemSettings).where(eq(systemSettings.key, PIPNET_KEY)).limit(1);
    const stored = rows[0]?.value as Partial<PipnetCreds> | null | undefined;
    if (stored?.username && stored?.email && stored?.password) {
      return { username: stored.username, email: stored.email, password: stored.password };
    }
  } catch (err: any) {
    console.warn("[pipnet creds] DB lookup failed, falling back to env:", err?.message);
  }
  return {
    username: process.env.PIPNET_USERNAME || "helliott",
    email: process.env.PIPNET_EMAIL || "",
    password: process.env.PIPNET_PASSWORD || "",
  };
}

export async function setPipnetCreds(creds: PipnetCreds): Promise<void> {
  const value = { username: creds.username.trim(), email: creds.email.trim(), password: creds.password };
  const existing = await db.select().from(systemSettings).where(eq(systemSettings.key, PIPNET_KEY)).limit(1);
  if (existing.length > 0) {
    await db.update(systemSettings).set({ value, updatedAt: new Date() }).where(eq(systemSettings.key, PIPNET_KEY));
  } else {
    await db.insert(systemSettings).values({ key: PIPNET_KEY, value });
  }
}

export async function clearPipnetCreds(): Promise<void> {
  await db.delete(systemSettings).where(eq(systemSettings.key, PIPNET_KEY));
}

export async function getPipnetCredsStatus(): Promise<{ configured: boolean; source: "db" | "env" | "none"; usernameMasked: string; emailMasked: string }> {
  try {
    const rows = await db.select().from(systemSettings).where(eq(systemSettings.key, PIPNET_KEY)).limit(1);
    const stored = rows[0]?.value as Partial<PipnetCreds> | null | undefined;
    if (stored?.username && stored?.email && stored?.password) {
      return { configured: true, source: "db", usernameMasked: mask(stored.username), emailMasked: mask(stored.email) };
    }
  } catch {}
  const envUser = process.env.PIPNET_USERNAME || "";
  const envEmail = process.env.PIPNET_EMAIL || "";
  const envPass = process.env.PIPNET_PASSWORD || "";
  if (envUser && envEmail && envPass) {
    return { configured: true, source: "env", usernameMasked: mask(envUser), emailMasked: mask(envEmail) };
  }
  return { configured: false, source: "none", usernameMasked: "", emailMasked: "" };
}

function mask(s: string): string {
  if (!s) return "";
  if (s.length <= 4) return "•".repeat(s.length);
  return s.slice(0, 2) + "•".repeat(Math.max(2, s.length - 4)) + s.slice(-2);
}
