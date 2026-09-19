import sharp from "sharp";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isPublicImageSourceUrl } from "./company-image-discovery";

export const BRAND_IMAGE_QUALITY_TAG = "image-quality:v1";
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const PHOTO_KINDS = ["storefront", "interior", "building", "food", "product"] as const;
export type PhotoKind = typeof PHOTO_KINDS[number];
export type ImageJudgment = {
  keep: boolean;
  photograph: boolean;
  relevant: boolean;
  kind: PhotoKind | "people" | "logo" | "graphic" | "other";
  quality: number;
};

export function isPublicImageAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return a > 0 && a < 224 && a !== 10 && a !== 127
      && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31)
      && !(a === 192 && (b === 168 || b === 0 || b === 2))
      && !(a === 100 && b >= 64 && b <= 127) && !(a === 198 && [18, 19, 51].includes(b))
      && !(a === 203 && b === 0 && c === 113);
  }
  // Only global unicast IPv6; exclude local/mapped addresses and examples.
  return isIP(address) === 6 && /^[23][0-9a-f]{3}:/i.test(address) && !/^2001:db8:/i.test(address);
}

/** Read bounded bodies and check every redirect before requesting its target. */
export async function fetchPublicImageSource(
  url: string,
  options: { maxBytes?: number; html?: boolean; fetcher?: typeof fetch;
    resolveHost?: (host: string) => Promise<Array<{ address: string }>> } = {},
): Promise<Buffer | null> {
  const limit = options.maxBytes ?? MAX_IMAGE_BYTES;
  const fetcher = options.fetcher ?? fetch;
  const signal = AbortSignal.timeout(12000);
  try {
    const initialHost = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    for (let hop = 0; hop < 5; hop++) {
      if (!isPublicImageSourceUrl(url)) return null;
      if (options.html && new URL(url).hostname.toLowerCase().replace(/^www\./, "") !== initialHost) return null;
      const addresses = await (options.resolveHost ?? (host => lookup(host, { all: true })))(new URL(url).hostname);
      if (!addresses.length || addresses.some(entry => !isPublicImageAddress(entry.address)) || signal.aborted) return null;
      const res = await fetcher(url, {
        signal, redirect: "manual",
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
          Accept: options.html ? "text/html,application/xhtml+xml" : "image/avif,image/webp,image/png,image/jpeg",
        },
      });
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const location = res.headers.get("location");
        await res.body?.cancel();
        if (!location) return null;
        url = new URL(location, url).toString();
        continue;
      }
      const type = res.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
      const binaryImage = !options.html && type === "application/octet-stream";
      if (!res.ok || !(options.html ? /^(text\/html|application\/xhtml\+xml)$/.test(type) : type.startsWith("image/") || binaryImage)) {
        await res.body?.cancel();
        return null;
      }
      if (Number(res.headers.get("content-length")) > limit || !res.body) {
        await res.body?.cancel();
        return null;
      }
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > limit) { await reader.cancel(); return null; }
        chunks.push(next.value);
      }
      const buffer = Buffer.concat(chunks);
      // Some official asset CDNs serve photographs as generic binary data.
      // Accept them only when the bytes identify a supported raster; the
      // caller still fully decodes and checks dimensions before any AI/store.
      if (binaryImage) {
        const metadata = await sharp(buffer, { failOn: "error", limitInputPixels: 40_000_000 }).metadata();
        if (!["jpeg", "png", "webp", "avif", "heif"].includes(metadata.format ?? "")) return null;
      }
      return buffer;
    }
  } catch { /* No candidate is preferable to an unverified download. */ }
  return null;
}

export async function prepareBrandPhoto(buffer: Buffer): Promise<{ buffer: Buffer; mime: string; width: number; height: number } | null> {
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) return null;
  try {
    const input = sharp(buffer, { failOn: "error", limitInputPixels: 40_000_000 });
    const metadata = await input.metadata();
    if (!["jpeg", "png", "webp", "avif", "heif"].includes(metadata.format ?? "") || (metadata.pages ?? 1) > 1) return null;
    const rotated = [5, 6, 7, 8].includes(metadata.orientation ?? 1);
    const width = (rotated ? metadata.height : metadata.width) ?? 0;
    const height = (rotated ? metadata.width : metadata.height) ?? 0;
    if (Math.max(width, height) < 800 || Math.min(width, height) < 500 || width / height < 0.5 || width / height > 2.4) return null;
    // Decode fully so a valid header followed by corrupt pixels cannot pass.
    // Normalise orientation and strip metadata; never enlarge source pixels.
    const photo = await input.rotate().resize(2400, 2400, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer({ resolveWithObject: true });
    return { buffer: photo.data, mime: "image/jpeg", width: photo.info.width, height: photo.info.height };
  } catch { return null; }
}

export function parseImageJudgment(raw: string): ImageJudgment | null {
  try {
    const value = JSON.parse(raw.trim());
    if (!value || typeof value !== "object" || Array.isArray(value)
      || typeof value.keep !== "boolean" || typeof value.photograph !== "boolean" || typeof value.relevant !== "boolean"
      || ![...PHOTO_KINDS, "people", "logo", "graphic", "other"].includes(value.kind)
      || !Number.isInteger(value.quality) || value.quality < 0 || value.quality > 100) return null;
    return { keep: value.keep, photograph: value.photograph, relevant: value.relevant, kind: value.kind, quality: value.quality };
  } catch { return null; }
}

export function isSuitableBrandPhoto(verdict: ImageJudgment | null, landlord = false): verdict is ImageJudgment & { kind: PhotoKind } {
  return !!verdict && verdict.keep === true && verdict.photograph === true && verdict.relevant === true
    && verdict.quality >= 70 && (landlord ? ["storefront", "interior", "building"] : PHOTO_KINDS).includes(verdict.kind as PhotoKind);
}

export function brandPhotoQualityTags(verdict: ImageJudgment): string[] {
  return [BRAND_IMAGE_QUALITY_TAG, `image-kind:${verdict.kind}`, `image-quality-score:${verdict.quality}`];
}

export function brandPhotoRank(verdict: ImageJudgment, width: number, height: number, landlord = false): number {
  const kindPreference = landlord ? { building: 25, interior: 18, storefront: 15, food: 0, product: 0 }
    : { storefront: 25, interior: 20, building: 12, food: 6, product: 4 };
  return verdict.quality + (kindPreference[verdict.kind as PhotoKind] ?? 0)
    + (width >= height && width / height <= 2 ? 8 : 0) + Math.min(8, width * height / 300_000);
}
