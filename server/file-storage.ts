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

// ── User upload history ────────────────────────────────────────────────────
// Lightweight table to surface "recently uploaded files" to ChatBGP so it can
// reference them in future sessions without requiring re-upload.

let _uploadsTableEnsured = false;
async function ensureUserUploadsTable() {
  if (_uploadsTableEnsured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_upload_history (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT,
      size INTEGER,
      url TEXT NOT NULL,
      uploaded_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_uuh_user ON user_upload_history (user_id, uploaded_at DESC)`);
  _uploadsTableEnsured = true;
}

export async function recordUserUpload(
  userId: string,
  storageKey: string,
  originalName: string,
  mimeType: string,
  size: number,
  url: string
): Promise<void> {
  try {
    await ensureUserUploadsTable();
    await pool.query(
      `INSERT INTO user_upload_history (user_id, storage_key, original_name, mime_type, size, url) VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, storageKey, originalName, mimeType, size, url]
    );
  } catch (e: any) {
    console.warn("[file-storage] recordUserUpload failed:", e?.message);
  }
}

export async function getRecentUserUploads(
  userId: string,
  limit = 8
): Promise<Array<{ storageKey: string; originalName: string; mimeType: string; size: number; url: string; uploadedAt: string }>> {
  try {
    await ensureUserUploadsTable();
    const result = await pool.query(
      `SELECT storage_key, original_name, mime_type, size, url, uploaded_at FROM user_upload_history WHERE user_id = $1 ORDER BY uploaded_at DESC LIMIT $2`,
      [userId, limit]
    );
    return result.rows.map(r => ({
      storageKey: r.storage_key,
      originalName: r.original_name,
      mimeType: r.mime_type,
      size: r.size,
      url: r.url,
      uploadedAt: r.uploaded_at,
    }));
  } catch (e: any) {
    console.warn("[file-storage] getRecentUserUploads failed:", e?.message);
    return [];
  }
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
