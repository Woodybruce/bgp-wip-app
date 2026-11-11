// The Investment Tracker's image, from ChatBGP (Jack, 2026-11-11: "in
// reality everyone will use chat"). When someone adds an asset in chat, or
// hands chat a photo or brochure for one, this is what files it and pins
// the image — and reports what the board ACTUALLY shows afterwards, so chat
// can never say "pinned" when the box is still empty.
//
// The wall: an asset with no image and no brochure comes back with
// needsImage: true, and chat must ask for the brochure or a photo.
import { pool } from "./db";
import { saveFile } from "./file-storage";
import { chatMediaBuffer } from "./letting-tracker-chat";
import { ensureTrackerHero, heroFromBrochurePdf, resolveHeroes, selectHero } from "./property-imagery";

export interface TrackerImageResult {
  /** What the tracker's Image box shows now. */
  image: "pinned" | "none";
  /** Plain sentences for chat to relay. */
  notes: string[];
  /** True when chat must ask the person for the brochure PDF or a photo. */
  needsImage: boolean;
}

const isImage = (name: string, type: string) => /^image\/(jpeg|png|webp)/i.test(type) || /\.(jpe?g|png|webp)$/i.test(name);
const isPdf = (name: string, type: string) => /pdf/i.test(type) || /\.pdf$/i.test(name);

export async function setTrackerImageFromChat(args: {
  trackerId: string;
  photoChatMediaFilename?: string | null;
  brochureChatMediaFilename?: string | null;
  /** Look in the asset's Files and the investment team's email when nothing was attached. */
  search?: boolean;
  userId?: string | null;
}): Promise<TrackerImageResult> {
  const notes: string[] = [];
  const { rows: [t] } = await pool.query(`SELECT id, property_id, asset_name FROM investment_tracker WHERE id = $1`, [args.trackerId]);
  if (!t) return { image: "none", notes: ["That asset isn't on the Investment Tracker."], needsImage: false };
  const propertyId: string = t.property_id;

  // 1. A photo the person attached — theirs is the image, whatever else exists.
  if (args.photoChatMediaFilename) {
    const file = await chatMediaBuffer(args.photoChatMediaFilename);
    if (!file) notes.push(`The photo "${args.photoChatMediaFilename}" wasn't found in the chat uploads — ask for it to be attached again.`);
    else if (!isImage(file.originalName, file.contentType)) notes.push(`"${file.originalName}" isn't a JPEG, PNG or WebP photo, so it wasn't used as the image.`);
    else {
      const { storeImageFromBuffer } = await import("./image-studio");
      const mimeType = /png/i.test(file.contentType) || /\.png$/i.test(file.originalName) ? "image/png" : /webp/i.test(file.contentType) || /\.webp$/i.test(file.originalName) ? "image/webp" : "image/jpeg";
      const stored = await storeImageFromBuffer({
        buffer: file.data,
        fileName: `${t.asset_name} — ${file.originalName}`.slice(0, 120),
        category: "Properties",
        tags: ["Hero", "Chat"],
        description: `Photo of ${t.asset_name}, attached in ChatBGP`,
        source: "upload",
        propertyId,
        mimeType,
        filenameHint: "tracker-hero",
      });
      await selectHero({ propertyId, imageStudioId: stored.id, selection: "manual", userId: args.userId || null });
      notes.push(`The photo "${file.originalName}" is pinned as the asset's image on the tracker.`);
    }
  }

  // 2. A brochure the person attached — filed on the asset; its best photo
  //    is used when no photo was given.
  if (args.brochureChatMediaFilename) {
    const file = await chatMediaBuffer(args.brochureChatMediaFilename);
    if (!file) notes.push(`The brochure "${args.brochureChatMediaFilename}" wasn't found in the chat uploads — ask for it to be attached again.`);
    else if (!isPdf(file.originalName, file.contentType)) notes.push(`"${file.originalName}" isn't a PDF, so it wasn't filed as the brochure.`);
    else {
      const safeName = file.originalName.replace(/[\/\\:*?"<>|]/g, "-");
      const { rows: have } = await pool.query(`SELECT 1 FROM investment_marketing_files WHERE tracker_id = $1 AND file_name = $2 LIMIT 1`, [t.id, safeName]);
      if (!have.length) {
        const crypto = await import("node:crypto");
        const key = `investment-marketing/${t.id}/${Date.now()}-${crypto.randomBytes(8).toString("hex")}.pdf`;
        await saveFile(key, file.data, "application/pdf", safeName);
        await pool.query(
          `INSERT INTO investment_marketing_files (tracker_id, file_name, file_path, file_type, file_size, mime_type)
           VALUES ($1, $2, $3, 'chat', $4, 'application/pdf')`,
          [t.id, safeName, key, file.data.length],
        );
      }
      notes.push(`The brochure "${file.originalName}" is filed on the asset (Files on its tracker row).`);
      const r = await heroFromBrochurePdf({ propertyId, pdfBuffer: file.data, label: file.originalName }).catch(() => "missing" as const);
      if (r === "selected") notes.push("Its best photo of the whole asset is pinned as the image.");
      else if (r === "missing") notes.push("The brochure has no photo showing the whole asset from outside.");
    }
  }

  // 3. Nothing attached (or nothing usable): the automatic rule.
  let showing = (await resolveHeroes([propertyId]))[propertyId];
  if (showing?.status !== "selected" && args.search !== false) {
    const outcome = await Promise.race([
      ensureTrackerHero(propertyId, { searchEmail: true }).catch(() => "no_brochure" as const),
      new Promise<"searching">((resolve) => setTimeout(() => resolve("searching"), 75_000)),
    ]);
    if (outcome === "selected" || outcome === "kept") notes.push("The asset's brochure was found in the team's files or email, filed on the asset, and its photo pinned.");
    else if (outcome === "searching") notes.push("The search of the team's email for the brochure is still running; the photo will appear on the tracker if one is found.");
    else if (outcome === "missing") notes.push("A brochure was found and filed, but it has no photo showing the whole asset.");
    else if (outcome === "ambiguous") notes.push("Several brochure photos are on file with no clear winner — one needs choosing in the Image box on the tracker row.");
    else notes.push("No brochure for this asset was found in its files or the investment team's email.");
    showing = (await resolveHeroes([propertyId]))[propertyId];
  }

  const pinned = showing?.status === "selected";
  return { image: pinned ? "pinned" : "none", notes, needsImage: !pinned };
}

/** The tracker row chat means, by id or by name. */
export async function findTrackerForChat(args: { trackerId?: string | null; assetName?: string | null }): Promise<{ id: string; assetName: string } | null> {
  if (args.trackerId) {
    const { rows } = await pool.query(`SELECT id, asset_name FROM investment_tracker WHERE id = $1`, [args.trackerId]);
    if (rows[0]) return { id: rows[0].id, assetName: rows[0].asset_name };
  }
  const name = String(args.assetName || "").trim();
  if (!name) return null;
  const { rows } = await pool.query(
    `SELECT id, asset_name FROM investment_tracker
      WHERE lower(asset_name) = lower($1) OR asset_name ILIKE $2
      ORDER BY (lower(asset_name) = lower($1)) DESC, created_at DESC LIMIT 2`,
    [name, `%${name}%`],
  );
  // More than one loose match and no exact one: chat must ask which.
  if (rows.length === 2 && rows[0].asset_name.toLowerCase() !== name.toLowerCase()) return null;
  return rows[0] ? { id: rows[0].id, assetName: rows[0].asset_name } : null;
}
