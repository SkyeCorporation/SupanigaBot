/**
 * Konversi media ke stiker WhatsApp (WebP 512x512 + metadata paket).
 *  - Gambar statis (PNG/JPG/WebP/dll) -> stiker statis; transparansi PNG dipertahankan.
 *  - GIF, video (termasuk GIF WhatsApp berbentuk MP4), dan WebP animasi -> stiker bergerak.
 *  - Stiker yang dikirim ulang hanya diganti metadata paketnya.
 */
const crypto = require("node:crypto");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const { findFfmpeg, runFfmpeg } = require("./ffmpeg");

const SIZE = 512;
const MAX_STATIC_BYTES = 100 * 1024;
const MAX_ANIMATED_BYTES = 900 * 1024;
const MAX_SECONDS = 8;
const ROOT_DIR = path.join(__dirname, "..", "..");
const TMP_DIR = path.join(ROOT_DIR, "tmp", "sticker");

const DEFAULT_PACK = { packname: "SupanigaMX", author: "Esdeath Bot" };

function isAnimatedMime(mime) {
  return /^(video\/|image\/gif)/.test(mime);
}

/** Bangun chunk EXIF khusus WhatsApp berisi nama & pembuat paket stiker. */
function buildExif({ packname, author }) {
  const json = Buffer.from(JSON.stringify({
    "sticker-pack-id": crypto.randomBytes(16).toString("hex"),
    "sticker-pack-name": String(packname || DEFAULT_PACK.packname).slice(0, 60),
    "sticker-pack-publisher": String(author || DEFAULT_PACK.author).slice(0, 60),
    emojis: [],
  }), "utf8");
  const header = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00]);
  header.writeUInt32LE(json.length, 14);
  return Buffer.concat([header, json]);
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.write(type, 0, "ascii");
  head.writeUInt32LE(data.length, 4);
  return Buffer.concat([head, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}

/** Sisipkan chunk EXIF ke WebP (membuat chunk VP8X bila belum ada). */
function injectExif(webp, exif, { width, height, hasAlpha }) {
  if (webp.length < 20 || webp.toString("ascii", 0, 4) !== "RIFF" || webp.toString("ascii", 8, 12) !== "WEBP") return webp;
  const chunks = [];
  for (let offset = 12; offset + 8 <= webp.length;) {
    const type = webp.toString("ascii", offset, offset + 4);
    const size = webp.readUInt32LE(offset + 4);
    const end = offset + 8 + size + (size % 2);
    chunks.push({ type, data: webp.subarray(offset + 8, offset + 8 + size) });
    offset = end;
  }
  let vp8x = chunks.find((c) => c.type === "VP8X");
  const rest = chunks.filter((c) => c.type !== "VP8X" && c.type !== "EXIF");
  let header;
  if (vp8x) {
    header = Buffer.from(vp8x.data);
  } else {
    header = Buffer.alloc(10);
    if (hasAlpha) header[0] |= 0x10;
    header.writeUIntLE(width - 1, 4, 3);
    header.writeUIntLE(height - 1, 7, 3);
  }
  header[0] |= 0x08; // flag EXIF
  const body = Buffer.concat([Buffer.from("WEBP", "ascii"), chunk("VP8X", header), ...rest.map((c) => chunk(c.type, c.data)), chunk("EXIF", exif)]);
  const riff = Buffer.alloc(8);
  riff.write("RIFF", 0, "ascii");
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}

async function staticSticker(buffer, { crop }) {
  const base = () => sharp(buffer, { failOn: "none", limitInputPixels: 60_000_000, pages: 1 })
    .rotate()
    .ensureAlpha()
    .resize(SIZE, SIZE, { fit: crop ? "cover" : "contain", position: "attention", background: { r: 0, g: 0, b: 0, alpha: 0 } });
  let output = null;
  for (const quality of [92, 80, 66, 52, 38, 24]) {
    output = await base().webp({ quality, alphaQuality: 100, effort: 5, smartSubsample: true }).toBuffer();
    if (output.length <= MAX_STATIC_BYTES) break;
  }
  return output;
}

async function animatedSticker(buffer, mime, { crop }) {
  const ffmpeg = await findFfmpeg();
  if (!ffmpeg) throw new Error("ffmpeg tidak tersedia, stiker bergerak tidak dapat dibuat. Jalankan npm install lalu mulai ulang bot.");
  await fsp.mkdir(TMP_DIR, { recursive: true });
  const dir = await fsp.mkdtemp(path.join(TMP_DIR, "s-"));
  const ext = mime.includes("gif") ? "gif" : mime.includes("webm") ? "webm" : "mp4";
  const input = path.join(dir, `in.${ext}`);
  const output = path.join(dir, "out.webp");
  try {
    await fsp.writeFile(input, buffer);
    const fit = crop
      ? `scale=${SIZE}:${SIZE}:force_original_aspect_ratio=increase,crop=${SIZE}:${SIZE}`
      : `scale=${SIZE}:${SIZE}:force_original_aspect_ratio=decrease,pad=${SIZE}:${SIZE}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`;
    let result = null;
    for (const [fps, quality] of [[15, 60], [15, 45], [12, 35], [10, 25], [8, 15]]) {
      const filter = `fps=${fps},format=rgba,${fit},format=rgba`;
      await runFfmpeg(ffmpeg, [
        "-i", input, "-t", String(MAX_SECONDS), "-vf", filter, "-an", "-vsync", "0",
        "-c:v", "libwebp", "-lossless", "0", "-q:v", String(quality), "-compression_level", "4",
        "-loop", "0", "-preset", "default", "-pix_fmt", "yuva420p", output,
      ]);
      result = await fsp.readFile(output);
      if (result.length <= MAX_ANIMATED_BYTES) break;
    }
    return result;
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * @param {Buffer} buffer media asal
 * @param {{ mime?: string, packname?: string, author?: string, crop?: boolean }} [options]
 * @returns {Promise<Buffer>} WebP siap kirim sebagai { sticker }
 */
async function toSticker(buffer, options = {}) {
  const mime = String(options.mime || "").toLowerCase();
  const pack = { packname: options.packname || DEFAULT_PACK.packname, author: options.author || DEFAULT_PACK.author };
  const meta = await sharp(buffer, { failOn: "none", animated: true }).metadata().catch(() => null);
  const isWebp = meta?.format === "webp";
  const animatedImage = !!meta && (meta.pages || 1) > 1;

  let webp;
  if (isAnimatedMime(mime) && !isWebp) webp = await animatedSticker(buffer, mime, options);
  else if (meta?.format === "gif" && animatedImage) webp = await animatedSticker(buffer, "image/gif", options);
  else if (isWebp && animatedImage) webp = buffer; // WebP animasi: pertahankan gerakannya
  else if (isWebp && meta.width === SIZE && meta.height === SIZE && mime.includes("webp") && options.keepSticker) webp = buffer;
  else webp = await staticSticker(buffer, options);

  const info = await sharp(webp, { failOn: "none" }).metadata().catch(() => null);
  return injectExif(webp, buildExif(pack), {
    width: info?.width || SIZE,
    height: info?.pageHeight || info?.height || SIZE,
    hasAlpha: info?.hasAlpha !== false,
  });
}

module.exports = { toSticker, buildExif, injectExif, DEFAULT_PACK };
