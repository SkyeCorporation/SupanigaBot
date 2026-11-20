/**
 * Kolase hasil pencarian bertema futuristic technology space (dipakai .pin dan .pixiv).
 * Latar dibuat acak setiap kali: nebula, galaksi, planet bercincin, warp streak, grid hex,
 * lantai grid perspektif, serta panel HUD. Watermark "SupanigaMX" memakai font Orbitron
 * bawaan (assets/fonts), sehingga tampil sama di semua hosting.
 */
const sharp = require("sharp");
const { svgToPng, esc, fontSafe, FONTS } = require("./render");

const TILE_W = 280;
const TILE_H = 372;
const GAP = 28;
const PAD_X = 76;
const PAD_TOP = 150;
const PAD_BOTTOM = 128;
const CUT = 22; // potongan sudut tile (chamfer)

const PALETTES = [
  { name: "CYAN-MAGENTA", a: "#22d3ee", b: "#e879f9", c: "#818cf8", base1: "#02030a", base2: "#0b1030" },
  { name: "ION-BLUE", a: "#38bdf8", b: "#a78bfa", c: "#22d3ee", base1: "#01030b", base2: "#0a0b2c" },
  { name: "AURORA", a: "#2dd4bf", b: "#a3e635", c: "#38bdf8", base1: "#010806", base2: "#04211f" },
  { name: "SOLAR", a: "#fb923c", b: "#f472b6", c: "#facc15", base1: "#090307", base2: "#260a1d" },
  { name: "PLASMA", a: "#f43f5e", b: "#c084fc", c: "#fb7185", base1: "#08020a", base2: "#1f0a26" },
  { name: "QUANTUM", a: "#60a5fa", b: "#34d399", c: "#c4b5fd", base1: "#02050c", base2: "#061a2a" },
];

const rand = (min, max) => min + Math.random() * (max - min);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const f1 = (n) => Math.round(n * 10) / 10;

function chamfer(x, y, w, h, c) {
  return `M${x + c} ${y} H${x + w} V${y + h - c} L${x + w - c} ${y + h} H${x} V${y + c} Z`;
}

function columnsFor(count) {
  if (count <= 4) return count;
  return count <= 6 ? 3 : 4;
}

/** Nebula lembut: dirender kecil, diburamkan, lalu diperbesar (cepat & halus). */
async function nebulaLayer(width, height, theme, extraColor) {
  const scale = 8;
  const w = Math.ceil(width / scale);
  const h = Math.ceil(height / scale);
  const colors = [theme.a, theme.b, theme.c, extraColor || theme.a, theme.b];
  const blobs = Array.from({ length: 8 }, (_, i) =>
    `<ellipse cx="${f1(rand(-0.1, 1.1) * w)}" cy="${f1(rand(-0.1, 1.0) * h)}" rx="${f1(rand(0.12, 0.34) * w)}" ry="${f1(rand(0.08, 0.24) * h)}" ` +
    `fill="${colors[i % colors.length]}" fill-opacity="${f1(rand(0.12, 0.32))}" transform="rotate(${Math.round(rand(-40, 40))} ${w / 2} ${h / 2})"/>`,
  ).join("");
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="bg" x1="0" y1="0" x2="${f1(rand(0.3, 1))}" y2="1">` +
    `<stop offset="0" stop-color="${theme.base1}"/><stop offset="0.55" stop-color="${theme.base2}"/><stop offset="1" stop-color="${theme.base1}"/></linearGradient></defs>` +
    `<rect width="100%" height="100%" fill="url(#bg)"/>${blobs}</svg>`,
  );
  return sharp(svg).blur(12).resize(width, height, { kernel: "cubic" }).blur(5).png().toBuffer();
}

function stars(width, height) {
  const out = [];
  const total = Math.round((width * height) / 3600);
  for (let i = 0; i < total; i++) {
    out.push(`<circle cx="${f1(rand(0, width))}" cy="${f1(rand(0, height))}" r="${f1(rand(0.35, 1.4))}" fill="#fff" fill-opacity="${f1(rand(0.2, 0.95))}"/>`);
  }
  for (let i = 0; i < 9; i++) {
    const x = f1(rand(0, width)), y = f1(rand(0, height * 0.75)), l = f1(rand(6, 14));
    out.push(`<g opacity="${f1(rand(0.55, 1))}"><circle cx="${x}" cy="${y}" r="${f1(l * 0.6)}" fill="url(#starGlow)"/>` +
      `<path d="M${x - l} ${y} H${x + l} M${x} ${y - l} V${y + l}" stroke="#fff" stroke-width="1.1" stroke-linecap="round"/><circle cx="${x}" cy="${y}" r="1.8" fill="#fff"/></g>`);
  }
  return out.join("");
}

/** Galaksi spiral tipis di salah satu sisi. */
function galaxy(width, height, theme) {
  const cx = rand(0.15, 0.85) * width;
  const cy = rand(0.25, 0.6) * height;
  const arms = [];
  for (let arm = 0; arm < 2; arm++) {
    for (let i = 0; i < 70; i++) {
      const t = i / 70;
      const angle = arm * Math.PI + t * Math.PI * 3.2;
      const r = 8 + t * rand(150, 190);
      const x = cx + Math.cos(angle) * r * 1.7 + rand(-6, 6);
      const y = cy + Math.sin(angle) * r * 0.55 + rand(-4, 4);
      arms.push(`<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(rand(0.6, 1.8))}" fill="${pick([theme.a, theme.b, "#ffffff"])}" fill-opacity="${f1(0.75 - t * 0.5)}"/>`);
    }
  }
  return `<g opacity="0.55"><ellipse cx="${f1(cx)}" cy="${f1(cy)}" rx="70" ry="22" fill="url(#core)"/>${arms.join("")}</g>`;
}

function planet(width, height, theme) {
  const left = Math.random() < 0.5;
  const pr = rand(0.14, 0.2) * height;
  const px = left ? rand(0.0, 0.3) * pr : width - rand(0.0, 0.3) * pr;
  const py = PAD_TOP * 0.2 + rand(0.0, 0.3) * pr;
  const lx = left ? 0.85 : 0.15;
  const tilt = left ? -14 : 14;
  return (
    `<radialGradient id="pl" cx="${lx}" cy="0.85" r="1.05"><stop offset="0" stop-color="${theme.a}" stop-opacity="0.95"/>` +
    `<stop offset="0.35" stop-color="${theme.b}" stop-opacity="0.45"/><stop offset="0.75" stop-color="${theme.base2}"/><stop offset="1" stop-color="${theme.base1}"/></radialGradient>` +
    `<circle cx="${f1(px)}" cy="${f1(py)}" r="${f1(pr + 8)}" fill="none" stroke="${theme.a}" stroke-opacity="0.5" stroke-width="12" filter="url(#haze)"/>` +
    `<circle cx="${f1(px)}" cy="${f1(py)}" r="${f1(pr)}" fill="url(#pl)"/>` +
    [1.75, 2.05, 2.4].map((k, i) =>
      `<ellipse cx="${f1(px)}" cy="${f1(py)}" rx="${f1(pr * k)}" ry="${f1(pr * (0.28 + i * 0.04))}" fill="none" stroke="${i % 2 ? theme.b : theme.a}" stroke-opacity="${0.6 - i * 0.15}" stroke-width="${2 - i * 0.5}" ${i === 2 ? 'stroke-dasharray="4 7"' : ""} transform="rotate(${tilt} ${f1(px)} ${f1(py)})"/>`,
    ).join("")
  );
}

function warpStreaks(width, height, theme) {
  const out = [];
  const angle = rand(-25, -12);
  for (let i = 0; i < 16; i++) {
    const x = rand(-0.2, 1.1) * width, y = rand(0, height), len = rand(80, 260);
    out.push(`<rect x="${f1(x)}" y="${f1(y)}" width="${f1(len)}" height="${f1(rand(0.8, 2.2))}" rx="1" fill="url(#streak)" opacity="${f1(rand(0.25, 0.7))}" transform="rotate(${f1(angle)} ${f1(x)} ${f1(y)})"/>`);
  }
  return out.join("");
}

function hexGrid(width, height, theme) {
  const r = 22;
  const w = Math.sqrt(3) * r;
  const cells = [];
  const fromRight = Math.random() < 0.5;
  for (let row = 0; row * r * 1.5 < height * 0.55; row++) {
    for (let col = 0; col * w < width * 0.35; col++) {
      if (Math.random() < 0.35) continue;
      const cx = (fromRight ? width - col * w - (row % 2) * (w / 2) : col * w + (row % 2) * (w / 2));
      const cy = row * r * 1.5 + PAD_TOP * 0.6;
      const pts = Array.from({ length: 6 }, (_, k) => {
        const a = (Math.PI / 3) * k + Math.PI / 6;
        return `${f1(cx + r * 0.92 * Math.cos(a))},${f1(cy + r * 0.92 * Math.sin(a))}`;
      }).join(" ");
      const fade = 1 - col / (width * 0.35 / w);
      const lit = Math.random() < 0.08;
      cells.push(`<polygon points="${pts}" fill="${lit ? theme.a : "none"}" fill-opacity="${lit ? 0.18 : 0}" stroke="${theme.a}" stroke-opacity="${f1(0.05 + fade * 0.22)}" stroke-width="1"/>`);
    }
  }
  return cells.join("");
}

function floorGrid(width, height, theme) {
  const horizon = height - PAD_BOTTOM - 40;
  const vx = width * rand(0.4, 0.6);
  const lines = [];
  for (let i = -18; i <= 18; i++) lines.push(`M${f1(vx)} ${f1(horizon)} L${f1(vx + i * width * 0.1)} ${height}`);
  for (let k = 1; k <= 9; k++) lines.push(`M0 ${f1(horizon + (height - horizon) * Math.pow(k / 9, 2.1))} H${width}`);
  return `<path d="${lines.join(" ")}" stroke="url(#floor)" stroke-width="1.3" fill="none"/>` +
    `<rect x="0" y="${f1(horizon - 1)}" width="${width}" height="2" fill="${theme.a}" fill-opacity="0.5"/>` +
    `<rect x="0" y="${f1(horizon - 14)}" width="${width}" height="28" fill="${theme.a}" fill-opacity="0.08" filter="url(#haze)"/>`;
}

function hud(width, height, theme, info) {
  const m = 20, c = 46;
  const parts = [];
  parts.push(`<path d="M${m} ${m + c} V${m} H${m + c} M${width - m - c} ${m} H${width - m} V${m + c} M${m} ${height - m - c} V${height - m} H${m + c} M${width - m - c} ${height - m} H${width - m} V${height - m - c}" fill="none" stroke="${theme.a}" stroke-width="2.5" stroke-linecap="square"/>`);
  const ticks = [];
  for (let x = m + c + 20; x < width - m - c - 20; x += 12) ticks.push(`M${x} ${m} V${m + ((x / 12) % 6 === 0 ? 10 : 5)}`);
  parts.push(`<path d="${ticks.join(" ")}" stroke="#fff" stroke-opacity="0.25" stroke-width="1"/>`);

  // Panel header
  const hy = 44, hh = 70;
  parts.push(`<path d="${chamfer(PAD_X - 6, hy, width - (PAD_X - 6) * 2, hh, 16)}" fill="${theme.base1}" fill-opacity="0.62" stroke="url(#edge)" stroke-width="1.5"/>`);
  parts.push(`<rect x="${PAD_X + 14}" y="${hy + 16}" width="4" height="${hh - 32}" fill="${theme.a}"/>`);
  parts.push(`<text x="${PAD_X + 30}" y="${hy + 30}" font-family="${FONTS.mono}" font-size="15" fill="${theme.a}" letter-spacing="3">${esc(info.source)} // VISUAL SEARCH${info.badge ? ` // ${esc(info.badge)}` : ""}</text>`);
  parts.push(`<text x="${PAD_X + 30}" y="${hy + 56}" font-family="${FONTS.display}" font-weight="700" font-size="24" fill="#ffffff" letter-spacing="1.5">${esc(info.query)}</text>`);
  parts.push(`<text x="${width - PAD_X - 14}" y="${hy + 30}" text-anchor="end" font-family="${FONTS.mono}" font-size="14" fill="#ffffff" fill-opacity="0.7" letter-spacing="2">PAGE ${String(info.page).padStart(2, "0")} · ${String(info.count).padStart(2, "0")} ITEMS</text>`);
  const bars = Array.from({ length: 14 }, (_, i) => `<rect x="${width - PAD_X - 14 - (14 - i) * 9}" y="${hy + 54 - rand(4, 16)}" width="5" height="${f1(rand(4, 16))}" fill="${i % 3 ? theme.a : theme.b}" fill-opacity="0.85"/>`);
  parts.push(bars.join(""));

  // Footer: data kecil kiri + watermark kanan
  const fy = height - PAD_BOTTOM / 2;
  parts.push(`<text x="${PAD_X}" y="${fy - 4}" font-family="${FONTS.mono}" font-size="13" fill="#ffffff" fill-opacity="0.55" letter-spacing="2">SECTOR ${Math.floor(rand(100, 999))}-${pick(["A", "B", "C", "X"])} · ${theme.name}</text>`);
  parts.push(`<text x="${PAD_X}" y="${fy + 16}" font-family="${FONTS.mono}" font-size="13" fill="${theme.a}" fill-opacity="0.8" letter-spacing="2">KETIK NOMOR UNTUK MENERIMA FOTO ASLI</text>`);
  return parts.join("");
}

function watermark(width, height, theme) {
  const fy = height - PAD_BOTTOM / 2 + 14;
  const x = width - PAD_X;
  const text = "SupanigaMX";
  const font = `font-family="${FONTS.display}" font-weight="900" font-size="38" letter-spacing="3" text-anchor="end"`;
  return (
    `<g>` +
    `<text x="${x}" y="${fy}" ${font} fill="${theme.a}" opacity="0.8" filter="url(#glow)">${text}</text>` +
    `<text x="${x}" y="${fy}" ${font} fill="url(#wm)" stroke="#ffffff" stroke-opacity="0.35" stroke-width="0.6">${text}</text>` +
    `<rect x="${x - 300}" y="${fy + 10}" width="300" height="2" fill="url(#edge)"/>` +
    `<text x="${x}" y="${fy + 30}" text-anchor="end" font-family="${FONTS.mono}" font-size="12" fill="#ffffff" fill-opacity="0.6" letter-spacing="5">ESDEATH SYSTEM</text>` +
    `</g>`
  );
}

function overlaySvg(width, height, theme, positions, info) {
  const defs =
    `<defs>` +
    `<radialGradient id="starGlow"><stop offset="0" stop-color="#fff" stop-opacity="0.55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="core"><stop offset="0" stop-color="#fff" stop-opacity="0.9"/><stop offset="0.4" stop-color="${theme.b}" stop-opacity="0.5"/><stop offset="1" stop-color="${theme.b}" stop-opacity="0"/></radialGradient>` +
    `<linearGradient id="streak" x1="0" x2="1"><stop offset="0" stop-color="${theme.a}" stop-opacity="0"/><stop offset="0.8" stop-color="${theme.a}"/><stop offset="1" stop-color="#fff"/></linearGradient>` +
    `<linearGradient id="floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${theme.a}" stop-opacity="0"/><stop offset="1" stop-color="${theme.a}" stop-opacity="0.6"/></linearGradient>` +
    `<linearGradient id="edge" x1="0" x2="1"><stop offset="0" stop-color="${theme.a}"/><stop offset="1" stop-color="${theme.b}"/></linearGradient>` +
    `<linearGradient id="wm" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="0.5" stop-color="${theme.a}"/><stop offset="1" stop-color="${theme.b}"/></linearGradient>` +
    `<filter id="haze" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="10"/></filter>` +
    `<filter id="glow" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>` +
    `<filter id="tileGlow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="14"/></filter>` +
    `<pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="1" fill="#000" fill-opacity="0.18"/></pattern>` +
    `</defs>`;
  const tileGlow = positions.map((p) =>
    `<path d="${chamfer(p.left, p.top + 14, TILE_W, TILE_H, CUT)}" fill="#000" fill-opacity="0.75"/>` +
    `<path d="${chamfer(p.left - 5, p.top - 5, TILE_W + 10, TILE_H + 10, CUT + 4)}" fill="none" stroke="url(#edge)" stroke-width="10" stroke-opacity="0.7"/>`,
  ).join("");
  const variant = Math.random();
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${defs}` +
    stars(width, height) +
    (variant < 0.5 ? galaxy(width, height, theme) : "") +
    warpStreaks(width, height, theme) +
    hexGrid(width, height, theme) +
    planet(width, height, theme) +
    floorGrid(width, height, theme) +
    `<rect width="${width}" height="${height}" fill="url(#scan)"/>` +
    `<g filter="url(#tileGlow)">${tileGlow}</g>` +
    hud(width, height, theme, info) +
    watermark(width, height, theme) +
    `</svg>`
  );
}

/** Frame tile (dirender terpisah di atas foto): tepi neon, sudut HUD, dan badge nomor. */
function tileFrameSvg(number, theme) {
  const n = String(number);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE_W}" height="${TILE_H}"><defs>` +
    `<linearGradient id="e" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${theme.a}"/><stop offset="1" stop-color="${theme.b}"/></linearGradient>` +
    `<linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.5"/><stop offset="0.28" stop-color="#000" stop-opacity="0"/><stop offset="0.78" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="${theme.base1}" stop-opacity="0.6"/></linearGradient></defs>` +
    `<path d="${chamfer(0, 0, TILE_W, TILE_H, CUT)}" fill="url(#shade)"/>` +
    `<path d="${chamfer(1.5, 1.5, TILE_W - 3, TILE_H - 3, CUT - 1)}" fill="none" stroke="url(#e)" stroke-width="3"/>` +
    `<path d="M${TILE_W - 40} ${TILE_H - 12} H${TILE_W - 12} V${TILE_H - 40}" fill="none" stroke="#fff" stroke-opacity="0.8" stroke-width="2.5"/>` +
    `<path d="M14 ${TILE_H - 16} H70" stroke="${theme.a}" stroke-width="2"/><path d="M14 ${TILE_H - 24} H44" stroke="${theme.b}" stroke-width="2"/>` +
    `<path d="M10 ${CUT + 6} L${CUT + 6} 10 H84 L94 20 V56 L84 66 H10 Z" fill="${theme.base1}" fill-opacity="0.85" stroke="url(#e)" stroke-width="2"/>` +
    `<text x="52" y="52" text-anchor="middle" font-family="${FONTS.display}" font-weight="900" font-size="30" fill="#ffffff">${n.padStart(2, "0")}</text>` +
    `</svg>`
  );
}

async function tileImage(buffer, theme, number) {
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${TILE_W}" height="${TILE_H}"><path d="${chamfer(0, 0, TILE_W, TILE_H, CUT)}" fill="#fff"/></svg>`);
  const photo = await sharp(buffer, { failOn: "none" })
    .rotate()
    .resize(TILE_W, TILE_H, { fit: "cover", position: "attention" })
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
  return sharp(photo).composite([{ input: svgToPng(tileFrameSvg(number, theme)) }]).png().toBuffer();
}

async function photoColor(buffer) {
  try {
    const { dominant } = await sharp(buffer).resize(32, 32).stats();
    return `rgb(${dominant.r},${dominant.g},${dominant.b})`;
  } catch { return null; }
}

/**
 * @param {Buffer[]} buffers foto (maks 8)
 * @param {{ source?: string, query?: string, page?: number, badge?: string, palette?: string[] }} [info]
 * @returns {Promise<Buffer>} JPEG kolase
 */
async function renderCollage(buffers, info = {}) {
  const palettes = info.palette?.length ? PALETTES.filter((p) => info.palette.includes(p.name)) : PALETTES;
  const theme = pick(palettes.length ? palettes : PALETTES);
  const count = buffers.length;
  const cols = columnsFor(count);
  const rows = Math.ceil(count / cols);
  const width = Math.max(PAD_X * 2 + cols * TILE_W + (cols - 1) * GAP, 980);
  const height = PAD_TOP + PAD_BOTTOM + rows * TILE_H + (rows - 1) * GAP;
  const gridW = cols * TILE_W + (cols - 1) * GAP;
  const startX = Math.round((width - gridW) / 2);
  const positions = buffers.map((_, i) => {
    const row = Math.floor(i / cols);
    const inRow = Math.min(cols, count - row * cols);
    const offset = ((cols - inRow) * (TILE_W + GAP)) / 2;
    return { left: Math.round(startX + offset + (i % cols) * (TILE_W + GAP)), top: PAD_TOP + row * (TILE_H + GAP) };
  });
  const meta = {
    source: fontSafe(info.source || "SUPANIGAMX", 20, "SUPANIGAMX").toUpperCase(),
    query: fontSafe(info.query || "", 48, "RESULT").toUpperCase(),
    page: Number(info.page) || 1,
    count,
    badge: info.badge ? fontSafe(info.badge, 12).toUpperCase() : "",
  };
  const [nebula, tiles] = await Promise.all([
    photoColor(buffers[0]).then((color) => nebulaLayer(width, height, theme, color)),
    Promise.all(buffers.map((b, i) => tileImage(b, theme, i + 1))),
  ]);
  const overlay = svgToPng(overlaySvg(width, height, theme, positions, meta));
  const layers = [{ input: overlay, left: 0, top: 0 }];
  tiles.forEach((tile, i) => layers.push({ input: tile, left: positions[i].left, top: positions[i].top }));
  return sharp(nebula).composite(layers).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
}

module.exports = { renderCollage, PALETTES };
