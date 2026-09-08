import sharp from "sharp";

const MAX_CACHE_IMAGES = 3;
const MAX_CACHE_BYTES = 24 * 1024 * 1024;
const displayCache = new Map<string, Buffer>();
const pendingDisplays = new Map<string, Promise<Buffer>>();
let cachedBytes = 0;

// This is a reversible display treatment, never a replacement plan or a
// detection input. Neutral drawing pixels are copied byte-for-byte.
export async function hideRedPlanInk(source: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(source, { limitInputPixels: 40_000_000 })
    .toColourspace("srgb").flatten({ background: "white" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info, pixels = width * height;
  let mask = new Uint8Array(pixels);
  const red = (offset: number, strong: boolean) => {
    const r = data[offset], g = data[offset + 1], b = data[offset + 2];
    return r >= 100 && g >= b - 12 && r - g >= (strong ? 22 : 5) && r - b >= (strong ? 28 : 8);
  };
  for (let pixel = 0; pixel < pixels; pixel++) if (red(pixel * 3, true)) mask[pixel] = 1;
  // JPEG colour fringes are weaker than the original red stroke. Include
  // only nearby tinted pixels, keeping unrelated warm-grey paper intact.
  for (let pass = 0; pass < 2; pass++) {
    const grown = new Uint8Array(mask);
    for (let pixel = 0; pixel < pixels; pixel++) {
      if (mask[pixel] || !red(pixel * 3, false)) continue;
      const x = pixel % width, y = Math.floor(pixel / width);
      if ((x > 0 && mask[pixel - 1]) || (x + 1 < width && mask[pixel + 1])
        || (y > 0 && mask[pixel - width]) || (y + 1 < height && mask[pixel + width])) grown[pixel] = 1;
    }
    mask = grown;
  }
  const paper = (pixel: number) => {
    const offset = pixel * 3, r = data[offset], g = data[offset + 1], b = data[offset + 2];
    return !mask[pixel] && Math.min(r, g, b) >= 180 && Math.max(r, g, b) - Math.min(r, g, b) <= 24;
  };
  const median = (samples: number[][]) => [0, 1, 2].map(channel => samples.map(sample => sample[channel]).sort((a, b) => a - b)[Math.floor(samples.length / 2)]);
  const samples: number[][] = [];
  const stride = Math.max(1, Math.floor(pixels / 4096));
  for (let pixel = 0; pixel < pixels; pixel += stride) if (paper(pixel)) samples.push([data[pixel * 3], data[pixel * 3 + 1], data[pixel * 3 + 2]]);
  const fallback = samples.length ? median(samples) : [255, 255, 255];
  const output = Buffer.from(data);
  const directions = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
  for (let pixel = 0; pixel < pixels; pixel++) {
    if (!mask[pixel]) continue;
    const x = pixel % width, y = Math.floor(pixel / width), nearby: number[][] = [];
    for (const distance of [3, 6, 10]) for (const [dx, dy] of directions) {
      const nx = x + dx * distance, ny = y + dy * distance;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const neighbour = ny * width + nx;
      if (paper(neighbour)) nearby.push([data[neighbour * 3], data[neighbour * 3 + 1], data[neighbour * 3 + 2]]);
    }
    const colour = nearby.length ? median(nearby) : fallback;
    const offset = pixel * 3;
    output[offset] = colour[0]; output[offset + 1] = colour[1]; output[offset + 2] = colour[2];
  }
  return sharp(output, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

export async function redInkHiddenPlanImage(backgroundKey: string, source: Buffer): Promise<Buffer> {
  const key = `${backgroundKey}:hide-red-v1`;
  const cached = displayCache.get(key);
  if (cached) {
    displayCache.delete(key); displayCache.set(key, cached);
    return cached;
  }
  const pending = pendingDisplays.get(key);
  if (pending) return pending;
  const work = hideRedPlanInk(source).then(buffer => {
    if (buffer.length <= MAX_CACHE_BYTES) {
      while (displayCache.size >= MAX_CACHE_IMAGES || cachedBytes + buffer.length > MAX_CACHE_BYTES) {
        const oldest = displayCache.keys().next().value;
        if (!oldest) break;
        cachedBytes -= displayCache.get(oldest)!.length; displayCache.delete(oldest);
      }
      displayCache.set(key, buffer); cachedBytes += buffer.length;
    }
    return buffer;
  }).finally(() => { pendingDisplays.delete(key); });
  pendingDisplays.set(key, work);
  return work;
}
