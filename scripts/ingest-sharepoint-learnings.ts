import { ConfidentialClientApplication } from "@azure/msal-node";
import { db } from "../server/db";
import { pool } from "../server/db";
import { chatbgpLearnings } from "../shared/schema";
import { sql } from "drizzle-orm";
import OpenAI from "openai";
import * as path from "path";
import * as fs from "fs";
import mammoth from "mammoth";
import XLSX from "xlsx";

const PARENT_URL = "https://brucegillinghampollardlimited-my.sharepoint.com/:f:/g/personal/woody_brucegillinghampollard_com/IgA5N1cspPKHTJ8tcCdA-cRUAXmCOETID8BfvH-bxBgLNRE?e=tnDUgl";
const SUBFOLDER_NAME = process.argv[2] || "";
const MAX_DEPTH = parseInt(process.argv[3] || "1");
const SUPPORTED_EXTS = [".xlsx", ".xls", ".docx", ".pdf", ".csv", ".txt", ".doc", ".pptx"];

async function getMsToken(): Promise<string> {
  const tenantId = process.env.AZURE_TENANT_ID!;
  const clientId = process.env.AZURE_CLIENT_ID!;
  const clientSecret = process.env.AZURE_SECRET_V2 || process.env.AZURE_CLIENT_SECRET!;

  const result = await pool.query("SELECT cache_data FROM msal_token_cache LIMIT 1");
  const cacheJson = result.rows[0]?.cache_data;
  if (!cacheJson) throw new Error("No MSAL cache found");

  const cacheData = typeof cacheJson === "string" ? JSON.parse(cacheJson) : cacheJson;
  const accounts = cacheData.Account;
  const accountKey = Object.keys(accounts)[0];
  const account = accounts[accountKey];

  const cca = new ConfidentialClientApplication({
    auth: { clientId, authority: `https://login.microsoftonline.com/${tenantId}`, clientSecret },
  });
  await cca.getTokenCache().deserialize(JSON.stringify(cacheData));

  const silentResult = await cca.acquireTokenSilent({
    scopes: ["https://graph.microsoft.com/.default"],
    account: {
      homeAccountId: account.home_account_id,
      environment: account.environment,
      tenantId: account.realm,
      username: account.username,
      localAccountId: account.local_account_id,
    },
  });

  if (!silentResult?.accessToken) throw new Error("Failed to get token");
  return silentResult.accessToken;
}

async function listChildren(driveId: string, itemId: string, token: string, parentPath: string, depth: number = 0): Promise<Array<{ id: string; name: string; folderPath: string }>> {
  if (depth > MAX_DEPTH) return [];
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/children?$top=200&$select=name,size,id,file,folder`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return [];
  const data = await res.json();
  const results: Array<{ id: string; name: string; folderPath: string }> = [];

  for (const item of data.value || []) {
    if (item.folder) {
      const subPath = parentPath ? `${parentPath}/${item.name}` : item.name;
      console.log(`  📁 ${subPath}`);
      const subFiles = await listChildren(driveId, item.id, token, subPath, depth + 1);
      results.push(...subFiles);
    } else if (item.file) {
      const ext = path.extname(item.name).toLowerCase();
      if (SUPPORTED_EXTS.includes(ext)) {
        results.push({ id: item.id, name: item.name, folderPath: parentPath });
      }
    }
  }
  return results;
}

async function extractText(filePath: string, fileName: string): Promise<string> {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".docx") {
    return (await mammoth.extractRawText({ path: filePath })).value;
  }
  if (ext === ".xlsx" || ext === ".xls") {
    const workbook = XLSX.readFile(filePath);
    return workbook.SheetNames.map(name => {
      const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name]);
      return `Sheet: ${name}\n${csv}`;
    }).join("\n\n");
  }
  if (ext === ".csv" || ext === ".txt") {
    return fs.readFileSync(filePath, "utf-8");
  }
  if (ext === ".pdf") {
    try {
      const { PDFParse } = await import("pdf-parse");
      const parser = new (PDFParse as any)(new Uint8Array(fs.readFileSync(filePath)));
      const data = await parser.getText();
      const text = typeof data === "string" ? data : (data as any).text || String(data);
      try { parser.destroy(); } catch {}
      return text;
    } catch { return ""; }
  }
  return "";
}

async function main() {
  const label = SUBFOLDER_NAME || "root";
  console.log(`🚀 Ingesting: ${label} (depth ${MAX_DEPTH})\n`);

  const token = await getMsToken();
  console.log("✅ Got Microsoft token\n");

  const encodedUrl = Buffer.from(PARENT_URL.trim()).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const driveItemRes = await fetch(
    `https://graph.microsoft.com/v1.0/shares/u!${encodedUrl}/driveItem`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!driveItemRes.ok) throw new Error(`Cannot access folder: ${driveItemRes.status}`);
  const driveItem = await driveItemRes.json();
  const driveId = driveItem.parentReference?.driveId;
  let folderId = driveItem.id;

  if (SUBFOLDER_NAME) {
    const childrenRes = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${folderId}/children?$top=200&$select=name,id,folder`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!childrenRes.ok) throw new Error("Cannot list parent folder");
    const children = await childrenRes.json();
    const subfolder = (children.value || []).find((c: any) => c.folder && c.name === SUBFOLDER_NAME);
    if (!subfolder) throw new Error(`Subfolder "${SUBFOLDER_NAME}" not found`);
    folderId = subfolder.id;
    console.log(`📂 Found subfolder: ${SUBFOLDER_NAME}\n`);
  }

  console.log("📂 Listing files...\n");
  const allFiles = await listChildren(driveId, folderId, token, "");
  console.log(`\n📄 Found ${allFiles.length} readable files\n`);

  const existing = await db.select({ sourceUserName: chatbgpLearnings.sourceUserName })
    .from(chatbgpLearnings)
    .where(sql`${chatbgpLearnings.sourceUserName} LIKE 'SharePoint:%'`);
  const alreadyDone = new Set(existing.map(l => l.sourceUserName));

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  const tempDir = path.join(process.cwd(), "uploads", "sp-temp");
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  let processed = 0, skipped = 0, totalLearnings = 0, errors = 0;

  for (const file of allFiles) {
    const label = file.folderPath ? `${file.folderPath}/${file.name}` : file.name;
    if (alreadyDone.has(`SharePoint: ${label}`) || alreadyDone.has(`SharePoint: ${file.name}`)) {
      skipped++;
      continue;
    }

    try {
      process.stdout.write(`📖 ${label}... `);
      const contentRes = await fetch(
        `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${file.id}/content`,
        { headers: { Authorization: `Bearer ${token}` }, redirect: "follow" }
      );
      if (!contentRes.ok) { console.log("❌ download failed"); errors++; continue; }

      const buffer = Buffer.from(await contentRes.arrayBuffer());
      const tempPath = path.join(tempDir, `learn-${Date.now()}-${file.name}`);
      fs.writeFileSync(tempPath, buffer);

      let text = "";
      try { text = await extractText(tempPath, file.name); } finally {
        try { fs.unlinkSync(tempPath); } catch {}
      }

      if (!text || text.trim().length < 50) { console.log("⏭️ too short"); skipped++; continue; }

      const completion = await openai.chat.completions.create({
        model: "gpt-5.4",
        messages: [
          {
            role: "system",
            content: `You are analysing business documents for BGP (Bruce Gillingham Pollard), a London commercial property consultancy. Extract the most important, reusable business knowledge as a JSON array. Each learning should be a standalone fact. Categories: client_intel, market_knowledge, bgp_process, property_insight, team_preference, general. Rules: Extract 3-10 learnings, be specific with names/numbers/addresses, skip boilerplate. Respond ONLY with: [{"category":"...","learning":"..."},...]`
          },
          { role: "user", content: `File: ${label}\n\nContent:\n${text.slice(0, 12000)}` }
        ],
        max_completion_tokens: 2000,
      });

      const raw = completion.choices[0]?.message?.content || "[]";
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      let count = 0;
      if (jsonMatch) {
        const items = JSON.parse(jsonMatch[0]);
        for (const item of items) {
          if (item.learning && item.learning.length > 10) {
            await db.insert(chatbgpLearnings).values({
              category: item.category || "general",
              learning: item.learning,
              sourceUserName: `SharePoint: ${label}`,
              confidence: "extracted",
              active: true,
            });
            count++;
          }
        }
      }
      totalLearnings += count;
      processed++;
      console.log(`✅ ${count} learnings`);
    } catch (err: any) {
      console.log(`❌ ${err.message?.substring(0, 80)}`);
      errors++;
    }
  }

  console.log(`\n🎯 DONE! Processed: ${processed}, Skipped: ${skipped}, Errors: ${errors}, New learnings: ${totalLearnings}`);
  process.exit(0);
}

main().catch((err) => { console.error("Fatal:", err.message); process.exit(1); });
