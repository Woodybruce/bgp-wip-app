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
): Promise<{ data: Buffer; contentType: string; storageKey: string; originalName: string } | null> {
  // Exact-match first (cheap, fast), then case-insensitive partial fallback so
  // "complete landsec" / "LANDSEC.xlsx" / the full bracketed name all resolve.
  // Most recent upload wins on partial matches.
  const exact = await pool.query(
    `SELECT storage_key, data, content_type, original_name FROM file_storage
       WHERE storage_key LIKE 'chat-media/%' AND original_name = $1
       ORDER BY storage_key DESC LIMIT 1`,
    [originalName]
  );
  if (exact.rows.length > 0) {
    const row = exact.rows[0];
    return { data: row.data, contentType: row.content_type, storageKey: row.storage_key, originalName: row.original_name };
  }
  const fuzzy = await pool.query(
    `SELECT storage_key, data, content_type, original_name FROM file_storage
       WHERE storage_key LIKE 'chat-media/%' AND original_name ILIKE $1
       ORDER BY storage_key DESC LIMIT 1`,
    [`%${originalName}%`]
  );
  if (fuzzy.rows.length === 0) return null;
  const row = fuzzy.rows[0];
  return { data: row.data, contentType: row.content_type, storageKey: row.storage_key, originalName: row.original_name };
}

// List chat-media files matching a case-insensitive search term, most recent
// first. Used by ChatBGP's `list_my_uploads` tool to enumerate files the user
// has shared without forcing them to remember the exact filename.
export async function searchChatMedia(
  searchTerm: string,
  limit = 20
): Promise<Array<{ storageKey: string; originalName: string; contentType: string; size: number }>> {
  const result = await pool.query(
    `SELECT storage_key, original_name, content_type, size FROM file_storage
       WHERE storage_key LIKE 'chat-media/%'
         AND ($1 = '' OR original_name ILIKE $2)
       ORDER BY storage_key DESC LIMIT $3`,
    [searchTerm, `%${searchTerm}%`, limit]
  );
  return result.rows.map(r => ({
    storageKey: r.storage_key,
    originalName: r.original_name,
    contentType: r.content_type,
    size: r.size,
  }));
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

// ── chat-media reachability ────────────────────────────────────────────────
// chat-media is one flat namespace shared by chat uploads, ChatBGP-generated
// documents and KYC uploads (passports, bank statements), and the download
// route is client-allowed — so an external client login must not be able to
// pull a file just because it knows (or guesses) a filename. A client may
// read a chat-media file only when it is reachable from something they can
// already see: a file they uploaded themselves, or one referenced by a
// message in a thread they belong to (their own ChatBGP conversation is such
// a thread). BGP staff are not gated here — chat-media is internal storage
// and staff already reach these files through the surfaces that made them.
function likePatternFor(filename: string): string {
  return `%${filename.replace(/([\\%_])/g, "\\$1")}%`;
}

export async function clientCanReachChatMedia(
  userId: string,
  filename: string
): Promise<boolean> {
  const storageKey = `chat-media/${filename}`;
  try {
    await ensureUserUploadsTable();
    const own = await pool.query(
      `SELECT 1 FROM user_upload_history WHERE user_id = $1 AND storage_key = $2 LIMIT 1`,
      [userId, storageKey]
    );
    if (own.rows.length > 0) return true;
  } catch (e: any) {
    console.warn("[file-storage] chat-media upload-history check failed:", e?.message);
  }
  try {
    const pattern = likePatternFor(filename);
    const shared = await pool.query(
      `SELECT 1
         FROM chat_messages cm
         JOIN chat_threads ct ON ct.id = cm.thread_id
         LEFT JOIN chat_thread_members m ON m.thread_id = ct.id AND m.user_id = $1
        WHERE (ct.created_by = $1 OR m.user_id IS NOT NULL)
          AND (cm.content LIKE $2 ESCAPE '\\'
               OR EXISTS (SELECT 1 FROM unnest(COALESCE(cm.attachments, '{}')) a
                           WHERE a LIKE $2 ESCAPE '\\'))
        LIMIT 1`,
      [userId, pattern]
    );
    return shared.rows.length > 0;
  } catch (e: any) {
    console.warn("[file-storage] chat-media thread check failed:", e?.message);
    return false;
  }
}
