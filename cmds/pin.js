/**
 * PIN — cari foto dari Pinterest.
 * Bot mengirim SATU gambar kolase berisi 8 foto bernomor (anti spam), lalu user
 * cukup ketik angka di chat (tanpa reply). Bisa pilih beberapa dengan koma: 1, 2, 3
 */
const sharp = require("sharp");
const MAX_RESULTS = 8;
const PAGE_SIZE = 25;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const RESULT_TTL = 15 * 60 * 1000;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const SELECTION_RE = /^\d{1,2}(\s*,\s*\d{1,2})*$/;
const searches = new Map();

function keyFor(chatJid, senderNumber) {
  return `${chatJid}:${senderNumber}`;
}
function prune() {
  const now = Date.now();
  for (const [key, result] of searches) if (result.expiresAt <= now) searches.delete(key);
}
function errorText(error) {
  return String(error?.message || error || "Kesalahan tidak diketahui").replace(/[\r\n\t]+/g, " ").slice(0, 600);
}
function clean(value, max = 120) {
  return String(value || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, max);
}
function isPinimg(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "i.pinimg.com" || url.hostname.endsWith(".pinimg.com"));
  } catch { return false; }
}

/** "1, 2, 3" -> [1, 2, 3] (unik, urut sesuai ketikan). */
function parseSelection(text) {
  const value = String(text || "").trim();
  if (!SELECTION_RE.test(value)) return null;
  return [...new Set(value.split(",").map((part) => Number(part.trim())))];
}

async function pinterestPage(keyword, bookmark) {
  const data = { options: { query: keyword, scope: "pins", page_size: PAGE_SIZE, bookmarks: bookmark ? [bookmark] : [] }, context: {} };
  const sourceUrl = `/search/pins/?q=${encodeURIComponent(keyword)}`;
  const url = `https://www.pinterest.com/resource/BaseSearchResource/get/?source_url=${encodeURIComponent(sourceUrl)}&data=${encodeURIComponent(JSON.stringify(data))}`;
  const response = await fetch(url, {
    headers: {
      "user-agent": UA,
      accept: "application/json, text/javascript, */*; q=0.01",
      "x-requested-with": "XMLHttpRequest",
      "x-pinterest-pws-handler": "www/search/[scope].js",
      referer: "https://www.pinterest.com/",
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`Pinterest merespons HTTP ${response.status}`);
  const json = await response.json().catch(() => null);
  const res = json?.resource_response;
  if (!res) throw new Error("Respons Pinterest tidak bisa dibaca.");
  const pins = (res.data?.results || []).map((pin) => {
    const images = pin.images || {};
    const full = images.orig?.url || images["736x"]?.url;
    const preview = images["474x"]?.url || images["236x"]?.url || full;
    const title = clean(pin.title || pin.grid_title || pin.description || pin.auto_alt_text, 120) || "Foto Pinterest";
    const link = /^\d+$/.test(String(pin.id)) ? `https://www.pinterest.com/pin/${pin.id}/` : null;
    return { title, full, preview, link };
  }).filter((pin) => isPinimg(pin.full) && isPinimg(pin.preview));
  const next = res.bookmark && res.bookmark !== "-end-" ? res.bookmark : null;
  return { pins, next };
}

/** Kumpulkan hasil sampai halaman yang diminta (8 foto per halaman). */
async function searchPinterest(keyword, page) {
  const needed = page * MAX_RESULTS;
  const all = [];
  const seen = new Set();
  let bookmark = null;
  for (let i = 0; i < 12 && all.length < needed; i++) {
    const { pins, next } = await pinterestPage(keyword, bookmark);
    for (const pin of pins) if (!seen.has(pin.full)) { seen.add(pin.full); all.push(pin); }
    if (!next) break;
    bookmark = next;
  }
  return all.slice((page - 1) * MAX_RESULTS, needed);
}

async function downloadImage(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { "user-agent": UA, referer: "https://www.pinterest.com/" } });
  if (!response.ok) throw new Error(`Unduh gambar HTTP ${response.status}`);
  const mime = response.headers.get("content-type") || "";
  if (!mime.startsWith("image/")) throw new Error(`URL bukan gambar (${mime || "content-type kosong"})`);
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_IMAGE_BYTES) throw new Error("Ukuran gambar melebihi 8 MB");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) throw new Error(`Gambar kosong atau melebihi 8 MB (${buffer.length} byte)`);
  return { buffer, mime };
}


// Angka digambar sebagai garis SVG (bukan font) agar tetap tampil di server tanpa font.
const DIGITS = {
  0: "M20 8 C11 8 9 20 9 30 C9 40 11 52 20 52 C29 52 31 40 31 30 C31 20 29 8 20 8 Z",
  1: "M12 16 L22 8 V52",
  2: "M10 18 C10 6 30 6 30 18 C30 29 10 39 10 52 H31",
  3: "M10 13 C14 6 30 6 30 18 C30 26 23 29 18 29 C25 29 31 33 31 41 C31 54 14 56 9 47",
  4: "M26 52 V8 L8 38 H33",
  5: "M30 8 H13 L11 28 C14 25 18 24 21 24 C28 24 32 30 32 38 C32 50 22 54 16 52 C13 51 11 49 9 47",
  6: "M28 10 C14 7 9 22 9 36 C9 48 15 53 20 53 C27 53 31 47 31 40 C31 33 27 28 20 28 C14 28 9 33 9 38",
  7: "M9 8 H31 L17 52",
  8: "M20 29 C12 29 11 23 11 19 C11 12 15 8 20 8 C25 8 29 12 29 19 C29 23 28 29 20 29 C11 29 9 36 9 41 C9 48 14 53 20 53 C26 53 31 48 31 41 C31 36 29 29 20 29 Z",
  9: "M31 22 C31 27 26 32 20 32 C13 32 9 27 9 20 C9 13 14 8 20 8 C27 8 31 13 31 22 C31 38 27 52 12 51",
};
// Huruf watermark "SupanigaMX", juga digambar sebagai garis (tinggi huruf besar 0-40, garis dasar 40).
const LETTERS = {
  S: { w: 30, d: "M27 8 C24 3 19 2 15 2 C8 2 4 6 4 11 C4 23 28 17 28 30 C28 36 22 40 15 40 C10 40 5 38 3 34" },
  u: { w: 26, d: "M4 14 V30 C4 37 8 40 13 40 C19 40 23 36 23 30 M23 14 V40" },
  p: { w: 28, d: "M4 14 V52 M4 27 C4 19 9 14 15 14 C21 14 25 20 25 27 C25 34 21 40 15 40 C9 40 4 35 4 27" },
  a: { w: 27, d: "M23 14 V40 M23 27 C23 19 18 14 12.5 14 C7 14 3 20 3 27 C3 34 7 40 12.5 40 C18 40 23 35 23 27" },
  n: { w: 26, d: "M4 40 V14 M4 26 C4 18 9 14 13.5 14 C19 14 23 18 23 26 V40" },
  i: { w: 9, d: "M4.5 18 V40 M4.5 6 V6.5" },
  g: { w: 27, d: "M23 14 V44 C23 51 18 54 12.5 54 C8 54 5 52.5 3.5 50 M23 27 C23 19 18 14 12.5 14 C7 14 3 20 3 27 C3 34 7 40 12.5 40 C18 40 23 35 23 27" },
  M: { w: 38, d: "M4 40 V2 L19 28 L34 2 V40" },
  X: { w: 31, d: "M4 2 L27 40 M27 2 L4 40" },
};
const WATERMARK = "SupanigaMX";

const TILE_W = 280;
const TILE_H = 372; // potret 3:4 seperti pin Pinterest
const GAP = 26;
const PAD_X = 72;
const PAD_TOP = 64;
const PAD_BOTTOM = 92; // ruang watermark
const RADIUS = 20;
const BADGE = 62;

// Tema space-tech: tiap kolase memilih palet & tata letak latar secara acak.
const PALETTES = [
  { a: "#22d3ee", b: "#d946ef", base1: "#03040c", base2: "#0a0f2e" }, // cyan-magenta
  { a: "#3b82f6", b: "#a855f7", base1: "#02030a", base2: "#0c0a2a" }, // biru-ungu
  { a: "#2dd4bf", b: "#84cc16", base1: "#020807", base2: "#06201e" }, // teal-hijau
  { a: "#f97316", b: "#ec4899", base1: "#08030a", base2: "#24081f" }, // oranye-pink
  { a: "#38bdf8", b: "#f43f5e", base1: "#03050d", base2: "#170b24" }, // biru-merah
];
const rand = (min, max) => min + Math.random() * (max - min);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const f1 = (n) => Math.round(n * 10) / 10;

function badgeSvg(number, theme) {
  const digits = String(number).split("");
  const glyphW = 40 * 0.58;
  const startX = BADGE / 2 - (digits.length * glyphW) / 2;
  const paths = digits.map((d, i) =>
    `<path d="${DIGITS[d]}" transform="translate(${startX + i * glyphW} ${BADGE / 2 - 30 * 0.58}) scale(0.58)" fill="none" stroke="#ffffff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`,
  ).join("");
  const c = BADGE / 2;
  const hex = Array.from({ length: 6 }, (_, i) => {
    const ang = (Math.PI / 3) * i - Math.PI / 2;
    return `${f1(c + (c - 6) * Math.cos(ang))},${f1(c + (c - 6) * Math.sin(ang))}`;
  }).join(" ");
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${BADGE}" height="${BADGE}"><defs>` +
    `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${theme.a}"/><stop offset="1" stop-color="${theme.b}"/></linearGradient></defs>` +
    `<polygon points="${hex}" fill="#050816" fill-opacity="0.82" stroke="url(#g)" stroke-width="3.5" stroke-linejoin="round"/>${paths}</svg>`,
  );
}

/** Watermark kecil "SupanigaMX" (SVG), tinggi huruf besar = capHeight px. */
function watermarkSvg(theme, capHeight = 17) {
  const k = capHeight / 40;
  const spacing = 5;
  let x = 0;
  const paths = WATERMARK.split("").map((ch) => {
    const glyph = LETTERS[ch];
    const out = `<path d="${glyph.d}" transform="translate(${x} 0)"/>`;
    x += glyph.w + spacing;
    return out;
  }).join("");
  const width = Math.ceil((x - spacing) * k) + 8;
  const height = Math.ceil(56 * k) + 8;
  return {
    width,
    height,
    input: Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<g transform="translate(4 4) scale(${k})" fill="none" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round">` +
      `<g stroke="${theme.a}" stroke-opacity="0.55" transform="translate(1.5 2)">${paths}</g>` +
      `<g stroke="#ffffff" stroke-opacity="0.82">${paths}</g></g></svg>`,
    ),
  };
}

async function tileImage(buffer, theme) {
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${TILE_W}" height="${TILE_H}"><rect width="${TILE_W}" height="${TILE_H}" rx="${RADIUS}" ry="${RADIUS}"/></svg>`);
  const t = 26; // panjang sudut HUD
  const overlay = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE_W}" height="${TILE_H}"><defs>` +
    `<linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.55"/><stop offset="0.3" stop-color="#000" stop-opacity="0"/>` +
    `<stop offset="0.75" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="${theme.base2}" stop-opacity="0.55"/></linearGradient>` +
    `<linearGradient id="b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${theme.a}"/><stop offset="1" stop-color="${theme.b}"/></linearGradient></defs>` +
    `<rect width="${TILE_W}" height="${TILE_H}" fill="url(#t)"/>` +
    `<rect x="1.5" y="1.5" width="${TILE_W - 3}" height="${TILE_H - 3}" rx="${RADIUS - 1}" fill="none" stroke="url(#b)" stroke-opacity="0.9" stroke-width="3"/>` +
    `<path d="M${TILE_W - 10 - t} ${TILE_H - 10} H${TILE_W - 10} V${TILE_H - 10 - t}" fill="none" stroke="#ffffff" stroke-opacity="0.75" stroke-width="2.5" stroke-linecap="round"/></svg>`,
  );
  return sharp(buffer)
    .resize(TILE_W, TILE_H, { fit: "cover", position: "attention" })
    .composite([{ input: overlay }, { input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
}

/** Warna paling dominan dari foto pertama, dipakai sebagai salah satu warna nebula. */
async function photoColor(buffer) {
  try {
    const { dominant } = await sharp(buffer).resize(32, 32).stats();
    return `rgb(${dominant.r},${dominant.g},${dominant.b})`;
  } catch { return null; }
}

/** Nebula lembut: digambar kecil lalu diburamkan & diperbesar supaya halus dan cepat. */
async function nebulaLayer(width, height, theme, extraColor) {
  const scale = 8;
  const w = Math.ceil(width / scale);
  const h = Math.ceil(height / scale);
  const colors = [theme.a, theme.b, theme.b, extraColor || theme.a];
  const blobs = Array.from({ length: 6 }, (_, i) =>
    `<ellipse cx="${f1(rand(-0.1, 1.1) * w)}" cy="${f1(rand(-0.1, 0.9) * h)}" rx="${f1(rand(0.14, 0.32) * w)}" ry="${f1(rand(0.1, 0.24) * h)}" ` +
    `fill="${colors[i % colors.length]}" fill-opacity="${f1(rand(0.14, 0.3))}" transform="rotate(${Math.round(rand(-35, 35))} ${w / 2} ${h / 2})"/>`,
  ).join("");
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="bg" x1="0" y1="0" x2="${f1(rand(0.3, 1))}" y2="1">` +
    `<stop offset="0" stop-color="${theme.base1}"/><stop offset="0.6" stop-color="${theme.base2}"/><stop offset="1" stop-color="${theme.base1}"/></linearGradient></defs>` +
    `<rect width="100%" height="100%" fill="url(#bg)"/>${blobs}</svg>`,
  );
  return sharp(svg).blur(14).resize(width, height, { kernel: "cubic" }).blur(6).png().toBuffer();
}

/** Bintang, planet, lantai grid perspektif, dan bingkai HUD (tajam, resolusi penuh). */
function techLayer(width, height, theme) {
  const parts = [];
  // Bintang kecil + beberapa bintang terang berkilau.
  for (let i = 0; i < Math.round((width * height) / 4200); i++) {
    parts.push(`<circle cx="${f1(rand(0, width))}" cy="${f1(rand(0, height * 0.8))}" r="${f1(rand(0.4, 1.5))}" fill="#ffffff" fill-opacity="${f1(rand(0.25, 0.95))}"/>`);
  }
  for (let i = 0; i < 7; i++) {
    const x = f1(rand(0, width)), y = f1(rand(0, height * 0.7)), l = f1(rand(5, 11));
    parts.push(`<g stroke="#ffffff" stroke-width="1.2" stroke-linecap="round" opacity="${f1(rand(0.6, 1))}"><path d="M${x - l} ${y} H${x + l} M${x} ${y - l} V${y + l}"/></g><circle cx="${x}" cy="${y}" r="2" fill="#ffffff"/>`);
  }
  // Planet gelap dengan sinar tepi & cincin di salah satu sudut atas.
  const left = Math.random() < 0.5;
  const pr = rand(0.13, 0.19) * height;
  const px = left ? rand(0.05, 0.35) * pr : width - rand(0.05, 0.35) * pr;
  const py = rand(0.05, 0.35) * pr;
  const lx = left ? 0.85 : 0.15; // arah cahaya ke tengah kolase
  const tilt = left ? -16 : 16;
  parts.push(
    `<defs><radialGradient id="pl" cx="${lx}" cy="0.85" r="1.05"><stop offset="0" stop-color="${theme.a}" stop-opacity="0.9"/>` +
    `<stop offset="0.35" stop-color="${theme.b}" stop-opacity="0.45"/><stop offset="0.75" stop-color="${theme.base2}"/><stop offset="1" stop-color="${theme.base1}"/></radialGradient>` +
    `<filter id="hz" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="10"/></filter>` +
    `<linearGradient id="fl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${theme.a}" stop-opacity="0"/><stop offset="1" stop-color="${theme.a}" stop-opacity="0.55"/></linearGradient></defs>`,
    `<circle cx="${f1(px)}" cy="${f1(py)}" r="${f1(pr + 6)}" fill="none" stroke="${theme.a}" stroke-opacity="0.55" stroke-width="10" filter="url(#hz)"/>`,
    `<circle cx="${f1(px)}" cy="${f1(py)}" r="${f1(pr)}" fill="url(#pl)"/>`,
    `<ellipse cx="${f1(px)}" cy="${f1(py)}" rx="${f1(pr * 1.8)}" ry="${f1(pr * 0.3)}" fill="none" stroke="${theme.a}" stroke-opacity="0.6" stroke-width="2" transform="rotate(${tilt} ${f1(px)} ${f1(py)})"/>`,
    `<ellipse cx="${f1(px)}" cy="${f1(py)}" rx="${f1(pr * 2.05)}" ry="${f1(pr * 0.36)}" fill="none" stroke="${theme.b}" stroke-opacity="0.35" stroke-width="1.2" transform="rotate(${tilt} ${f1(px)} ${f1(py)})"/>`,
  );
  // Lantai grid perspektif ala sci-fi.
  const horizon = height * 0.72;
  const vx = width * rand(0.4, 0.6);
  const grid = [];
  for (let i = -14; i <= 14; i++) grid.push(`M${f1(vx)} ${f1(horizon)} L${f1(vx + i * width * 0.12)} ${height}`);
  for (let k = 1; k <= 9; k++) {
    const y = horizon + (height - horizon) * Math.pow(k / 9, 2.2);
    grid.push(`M0 ${f1(y)} H${width}`);
  }
  parts.push(`<path d="${grid.join(" ")}" stroke="url(#fl)" stroke-width="1.4" fill="none"/>`);
  parts.push(`<rect x="0" y="${f1(horizon - 1)}" width="${width}" height="2" fill="${theme.a}" fill-opacity="0.45"/>`);
  // Jalur sirkuit di sisi kiri & kanan.
  for (let i = 0; i < 5; i++) {
    const side = i % 2 === 0 ? 0 : 1;
    const y = f1(rand(0.12, 0.85) * height);
    const x1 = side ? width - 6 : 6;
    const dx = side ? -1 : 1;
    const run = rand(18, 40), bend = rand(10, 26) * (Math.random() < 0.5 ? -1 : 1);
    const ex = f1(x1 + dx * (run + 22)), ey = f1(y + bend);
    parts.push(`<path d="M${x1} ${y} H${f1(x1 + dx * run)} L${ex} ${ey}" fill="none" stroke="${pick([theme.a, theme.b])}" stroke-opacity="0.7" stroke-width="1.6"/>` +
      `<circle cx="${ex}" cy="${ey}" r="3" fill="none" stroke="${theme.a}" stroke-width="1.6"/>`);
  }
  // Bingkai HUD: sudut, garis skala atas, dan bar data kecil.
  const m = 18, c = 40;
  parts.push(`<path d="M${m} ${m + c} V${m} H${m + c} M${width - m - c} ${m} H${width - m} V${m + c} M${m} ${height - m - c} V${height - m} H${m + c} M${width - m - c} ${height - m} H${width - m} V${height - m - c}" fill="none" stroke="${theme.a}" stroke-opacity="0.85" stroke-width="2.5" stroke-linecap="round"/>`);
  const ticks = [];
  for (let x = m + c + 24; x < width - m - c - 24; x += 14) ticks.push(`M${x} ${m} V${m + ((x / 14) % 5 === 0 ? 9 : 5)}`);
  parts.push(`<path d="${ticks.join(" ")}" stroke="#ffffff" stroke-opacity="0.28" stroke-width="1"/>`);
  for (let i = 0; i < 6; i++) {
    parts.push(`<rect x="${m + 10}" y="${height - m - 30 + i * 0}" width="${f1(rand(8, 46))}" height="3" rx="1.5" fill="${pick([theme.a, theme.b])}" fill-opacity="0.75" transform="translate(${i * 0} ${-i * 7})"/>`);
  }
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${parts.join("")}</svg>`);
}

/** Jumlah kolom mengikuti jumlah foto: 1-4 satu baris, 5-6 jadi 3 kolom, 7-8 jadi 4 kolom. */
function columnsFor(count) {
  if (count <= 4) return count;
  return count <= 6 ? 3 : 4;
}

/** Satu gambar kolase tema space-tech: latar acak, foto bernomor bercahaya neon, watermark. */
async function renderGrid(buffers) {
  const theme = pick(PALETTES);
  const count = buffers.length;
  const cols = columnsFor(count);
  const rows = Math.ceil(count / cols);
  const width = PAD_X * 2 + cols * TILE_W + (cols - 1) * GAP;
  const height = PAD_TOP + PAD_BOTTOM + rows * TILE_H + (rows - 1) * GAP;
  const [nebula, tiles] = await Promise.all([
    photoColor(buffers[0]).then((color) => nebulaLayer(width, height, theme, color)),
    Promise.all(buffers.map((b) => tileImage(b, theme))),
  ]);
  const positions = tiles.map((_, i) => {
    const row = Math.floor(i / cols);
    const inRow = Math.min(cols, count - row * cols);
    const offset = ((cols - inRow) * (TILE_W + GAP)) / 2; // baris terakhir yang tidak penuh dibuat di tengah
    return { left: Math.round(PAD_X + offset + (i % cols) * (TILE_W + GAP)), top: PAD_TOP + row * (TILE_H + GAP) };
  });
  // Cahaya neon di belakang setiap foto + bayangan gelap di bawahnya.
  const glow = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs>` +
    `<filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="16"/></filter>` +
    `<linearGradient id="n" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${theme.a}"/><stop offset="1" stop-color="${theme.b}"/></linearGradient></defs>` +
    `<g filter="url(#s)">` +
    positions.map((p) => `<rect x="${p.left}" y="${p.top + 14}" width="${TILE_W}" height="${TILE_H}" rx="${RADIUS}" fill="#000" fill-opacity="0.7"/>` +
      `<rect x="${p.left - 4}" y="${p.top - 4}" width="${TILE_W + 8}" height="${TILE_H + 8}" rx="${RADIUS + 4}" fill="none" stroke="url(#n)" stroke-width="10" stroke-opacity="0.75"/>`).join("") +
    `</g></svg>`,
  );
  const mark = watermarkSvg(theme);
  const layers = [{ input: techLayer(width, height, theme), left: 0, top: 0 }, { input: glow, left: 0, top: 0 }];
  tiles.forEach((tile, i) => {
    const { left, top } = positions[i];
    layers.push({ input: tile, left, top });
    layers.push({ input: badgeSvg(i + 1, theme), left: left + 12, top: top + 12 });
  });
  layers.push({ input: mark.input, left: width - PAD_X - mark.width + 4, top: height - Math.round(PAD_BOTTOM / 2) - Math.round(mark.height / 2) + 4 });
  return sharp(nebula)
    .composite(layers)
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
}

module.exports = {
  config: {
    name: "pin",
    cooldown: 8,
    description: "Cari foto dari Pinterest, lalu pilih dengan ketik nomor (bisa 1, 2, 3)",
    usage: "pin <kata kunci> [-halaman]",
    category: "Media",
    price: 0,
    role: 0,
  },
  _parseSelection: parseSelection,
  _renderGrid: renderGrid,
  _searchPinterest: searchPinterest,
  _downloadImage: downloadImage,
  hasPendingSelection(chatJid, senderNumber, _quotedMessageId, text = "") {
    prune();
    return !!parseSelection(text) && searches.has(keyFor(chatJid, senderNumber));
  },
  onStart: async function ({ api, event, args, prefix }) {
    prune();
    const raw = args.join(" ").trim();
    const pageMatch = raw.match(/\s+-(\d+)\s*$/);
    const page = pageMatch ? Number(pageMatch[1]) : 1;
    const keyword = (pageMatch ? raw.slice(0, pageMatch.index) : raw).trim();
    if (!keyword || keyword.length > 120 || !Number.isSafeInteger(page) || page < 1 || page > 10) {
      return api.reply(`Gunakan: ${prefix}pin <kata kunci> [-halaman]\nContoh: ${prefix}pin kucing -2`);
    }

    await api.reply(`Mencari "${keyword}" di Pinterest...`);
    try {
      const found = await searchPinterest(keyword, page);
      if (!found.length) return api.reply(`Tidak ada foto Pinterest untuk "${keyword}" di halaman ${page}. Coba kata kunci lain.`);

      const downloads = await Promise.allSettled(found.map((item) => downloadImage(item.preview)));
      const sent = [];
      const buffers = [];
      const errors = [];
      downloads.forEach((result, i) => {
        if (result.status === "fulfilled") { sent.push(found[i]); buffers.push(result.value.buffer); }
        else errors.push(errorText(result.reason));
      });
      if (!sent.length) throw new Error(`Semua foto gagal diambil. ${errors[0] || ""}`.trim());

      const grid = await renderGrid(buffers);
      searches.set(keyFor(event.chatJid, event.senderNumber), { keyword, images: sent, expiresAt: Date.now() + RESULT_TTL });
      await api.sendMessage({
        image: grid,
        caption:
          `*Pinterest: ${keyword}*${page > 1 ? ` (halaman ${page})` : ""}\n` +
          `${sent.length} foto. Ketik nomor untuk menerima versi aslinya.\n` +
          `Contoh: 1 atau 1, 2, 3\nBerlaku 15 menit.`,
      });
    } catch (error) {
      const detail = errorText(error);
      console.error(`[pin] ${detail}`);
      await api.reply(`Pencarian PIN gagal: ${detail}`).catch(() => {});
    }
  },
  onReply: async function ({ api, event, text }) {
    prune();
    const key = keyFor(event.chatJid, event.senderNumber);
    const result = searches.get(key);
    const numbers = parseSelection(text);
    if (!result || !numbers) return false;
    const invalid = numbers.filter((n) => n < 1 || n > result.images.length);
    if (invalid.length) {
      await api.reply(`Nomor ${invalid.join(", ")} tidak tersedia. Pilih 1-${result.images.length}, pisahkan dengan koma.`);
      return true;
    }
    searches.delete(key);
    const failed = [];
    for (const n of numbers) {
      const item = result.images[n - 1];
      try {
        const { buffer } = await downloadImage(item.full);
        await api.sendMessage({ image: buffer, caption: `${n}. ${item.title}\nSumber: Pinterest${item.link ? `\n${item.link}` : ""}` });
      } catch (error) {
        failed.push(`${n} (${errorText(error)})`);
      }
    }
    if (failed.length) await api.reply(`Gagal mengirim foto nomor ${failed.join("; ")}`).catch(() => {});
    return true;
  },
};
