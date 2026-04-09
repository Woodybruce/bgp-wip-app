import { Pool } from "pg";
import * as fs from "fs";
import * as path from "path";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function saveFile(
  storageKey: string,
  data: Buffer,
  contentType: string,
  originalName?: string
): Promise<void> {
  await pool.query(
    `INSERT INTO file_storage (storage_key, data, content_type, original_name, size)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (storage_key) DO UPDATE SET data = $2, content_type = $3, original_name = $4, size = $5`,
    [storageKey, data, contentType, originalName || null, data.length]
  );
}

export async function getFile(
  storageKey: string
): Promise<{ data: Buffer; contentType: string; originalName: string | null; size: number } | null> {
  const result = await pool.query(
    `SELECT data, content_type, original_name, size FROM file_storage WHERE storage_key = $1`,
    [storageKey]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    data: row.data,
    contentType: row.content_type,
    originalName: row.original_name,
    size: row.size,
  };
}

export async function deleteFile(storageKey: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM file_storage WHERE storage_key = $1`,
    [storageKey]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function findChatMediaByOriginalName(
  originalName: string
): Promise<{ data: Buffer; contentType: string; storageKey: string } | null> {
  const result = await pool.query(
    `SELECT storage_key, data, content_type FROM file_storage WHERE storage_key LIKE 'chat-media/%' AND original_name = $1 ORDER BY storage_key DESC LIMIT 1`,
    [originalName]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    data: row.data,
    contentType: row.content_type,
    storageKey: row.storage_key,
  };
}

export async function fileExists(storageKey: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM file_storage WHERE storage_key = $1`,
    [storageKey]
  );
  return result.rows.length > 0;
}

export async function saveFileFromDisk(storageKey: string, filePath: string, contentType: string, originalName?: string): Promise<void> {
  const data = fs.readFileSync(filePath);
  await saveFile(storageKey, data, contentType, originalName);
}

export async function ensureFileOnDisk(storageKey: string, diskPath: string): Promise<boolean> {
  if (fs.existsSync(diskPath)) return true;
  const file = await getFile(storageKey);
  if (!file) return false;
  const dir = path.dirname(diskPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(diskPath, file.data);
  return true;
}

export async function syncFileToDisk(storageKey: string, diskPath: string): Promise<void> {
  const data = fs.readFileSync(diskPath);
  const ext = path.extname(diskPath).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel",
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".doc": "application/msword",
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
    ".gif": "image/gif", ".webp": "image/webp",
  };
  await saveFile(storageKey, data, mimeMap[ext] || "application/octet-stream", path.basename(diskPath));
}
