/**
 * Kartu status user bergaya futuristic HUD (dipakai .status dan .whois).
 * Berisi foto profil WhatsApp, nama bot, ID user, saldo, level, dan progres EXP.
 */
const sharp = require("sharp");
const { svgToPng, esc, fontSafe, FONTS } = require("./render");
const { PALETTES } = require("./collage");

const W = 1200;
const H = 630;
const AV = 300; // diameter avatar
const AX = 90;
const AY = 150;

const rand = (min, max) => min + Math.random() * (max - min);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const f1 = (n) => Math.round(n * 10) / 10;

function formatMoney(value) {
  return Math.trunc(Number(value) || 0).toLocaleString("id-ID");
}

async function fetchAvatar(url) {
  if (!url) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.length ? buffer : null;
  } catch { return null; }
}

function initialsAvatar(name, theme) {
  const initials = fontSafe(name, 40, "U").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "U";
  return svgToPng(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${AV}" height="${AV}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${theme.base2}"/><stop offset="1" stop-color="${theme.base1}"/></linearGradient></defs>` +
    `<rect width="${AV}" height="${AV}" fill="url(#g)"/>` +
    `<text x="${AV / 2}" y="${AV / 2 + 34}" text-anchor="middle" font-family="${FONTS.display}" font-weight="900" font-size="104" fill="${theme.a}">${esc(initials)}</text></svg>`,
  );
}

async function avatarLayer(buffer, name, theme) {
  const source = buffer || initialsAvatar(name, theme);
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${AV}" height="${AV}"><circle cx="${AV / 2}" cy="${AV / 2}" r="${AV / 2}" fill="#fff"/></svg>`);
  try {
    return await sharp(source, { failOn: "none" }).resize(AV, AV, { fit: "cover", position: "attention" }).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
  } catch {
    return sharp(initialsAvatar(name, theme)).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
  }
}

async function nebula(theme) {
  const w = W / 8, h = H / 8;
  const blobs = Array.from({ length: 7 }, (_, i) =>
    `<ellipse cx="${f1(rand(-0.1, 1.1) * w)}" cy="${f1(rand(-0.1, 1.1) * h)}" rx="${f1(rand(0.15, 0.35) * w)}" ry="${f1(rand(0.12, 0.3) * h)}" fill="${[theme.a, theme.b, theme.c][i % 3]}" fill-opacity="${f1(rand(0.12, 0.3))}"/>`,
  ).join("");
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${theme.base1}"/><stop offset="0.6" stop-color="${theme.base2}"/><stop offset="1" stop-color="${theme.base1}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#bg)"/>${blobs}</svg>`);
  return sharp(svg).blur(8).resize(W, H, { kernel: "cubic" }).blur(4).png().toBuffer();
}

function overlay(theme, data) {
  const cx = AX + AV / 2, cy = AY + AV / 2;
  const parts = [];
  for (let i = 0; i < 240; i++) parts.push(`<circle cx="${f1(rand(0, W))}" cy="${f1(rand(0, H))}" r="${f1(rand(0.3, 1.3))}" fill="#fff" fill-opacity="${f1(rand(0.15, 0.85))}"/>`);
  // Warp streak
  for (let i = 0; i < 10; i++) {
    const x = rand(0.3, 1.1) * W, y = rand(0, H), len = rand(80, 220);
    parts.push(`<rect x="${f1(x)}" y="${f1(y)}" width="${f1(len)}" height="1.4" fill="url(#streak)" opacity="${f1(rand(0.25, 0.6))}" transform="rotate(-18 ${f1(x)} ${f1(y)})"/>`);
  }
  // Grid perspektif bawah
  const horizon = H - 120;
  const grid = [];
  for (let i = -16; i <= 16; i++) grid.push(`M${W * 0.62} ${horizon} L${f1(W * 0.62 + i * W * 0.09)} ${H}`);
  for (let k = 1; k <= 6; k++) grid.push(`M0 ${f1(horizon + 120 * Math.pow(k / 6, 2))} H${W}`);
  parts.push(`<path d="${grid.join(" ")}" stroke="url(#floor)" stroke-width="1.2" fill="none"/>`);

  // Bingkai HUD
  const m = 22, c = 50;
  parts.push(`<path d="M${m} ${m + c} V${m} H${m + c} M${W - m - c} ${m} H${W - m} V${m + c} M${m} ${H - m - c} V${H - m} H${m + c} M${W - m - c} ${H - m} H${W - m} V${H - m - c}" fill="none" stroke="${theme.a}" stroke-width="2.5"/>`);
  parts.push(`<text x="60" y="78" font-family="${FONTS.mono}" font-size="17" fill="${theme.a}" letter-spacing="4">SUPANIGAMX // ${esc(data.title)}</text>`);
  parts.push(`<text x="${W - 60}" y="78" text-anchor="end" font-family="${FONTS.mono}" font-size="15" fill="#fff" fill-opacity="0.6" letter-spacing="3">${esc(data.stamp)}</text>`);
  parts.push(`<rect x="60" y="94" width="${W - 120}" height="1" fill="url(#edge)" opacity="0.7"/>`);

  // Cincin avatar + arc dinamis
  const r1 = AV / 2 + 14, r2 = AV / 2 + 30;
  const circ = 2 * Math.PI * r2;
  const progress = Math.max(0.02, Math.min(1, data.exp / data.expToNext));
  parts.push(`<circle cx="${cx}" cy="${cy}" r="${AV / 2 + 6}" fill="none" stroke="${theme.a}" stroke-width="12" opacity="0.5" filter="url(#glow)"/>`);
  parts.push(`<circle cx="${cx}" cy="${cy}" r="${r1}" fill="none" stroke="url(#edge)" stroke-width="3"/>`);
  parts.push(`<circle cx="${cx}" cy="${cy}" r="${r2}" fill="none" stroke="#fff" stroke-opacity="0.12" stroke-width="6"/>`);
  parts.push(`<circle cx="${cx}" cy="${cy}" r="${r2}" fill="none" stroke="${theme.b}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${f1(circ * progress)} ${f1(circ)}" transform="rotate(-90 ${cx} ${cy})"/>`);
  const ticks = [];
  for (let i = 0; i < 48; i++) {
    const a = (Math.PI * 2 * i) / 48;
    const ri = r2 + 12, ro = r2 + (i % 4 === 0 ? 22 : 17);
    ticks.push(`M${f1(cx + ri * Math.cos(a))} ${f1(cy + ri * Math.sin(a))} L${f1(cx + ro * Math.cos(a))} ${f1(cy + ro * Math.sin(a))}`);
  }
  parts.push(`<path d="${ticks.join(" ")}" stroke="${theme.a}" stroke-opacity="0.55" stroke-width="1.5"/>`);
  // Badge level di bawah avatar
  const bx = cx - 80, by = AY + AV + 18;
  parts.push(`<path d="M${bx + 14} ${by} H${bx + 160} L${bx + 174} ${by + 22} L${bx + 160} ${by + 44} H${bx + 14} L${bx} ${by + 22} Z" fill="${theme.base1}" stroke="url(#edge)" stroke-width="2"/>`);
  parts.push(`<text x="${cx + 7}" y="${by + 31}" text-anchor="middle" font-family="${FONTS.display}" font-weight="900" font-size="22" fill="#fff" letter-spacing="2">LV ${data.level}</text>`);

  // Panel info kanan
  const px = 500;
  parts.push(`<text x="${px}" y="170" font-family="${FONTS.mono}" font-size="16" fill="#fff" fill-opacity="0.6" letter-spacing="4">CODENAME</text>`);
  parts.push(`<text x="${px}" y="226" font-family="${FONTS.display}" font-weight="900" font-size="${data.name.length > 16 ? 40 : 52}" fill="url(#wm)">${esc(data.name)}</text>`);
  parts.push(`<rect x="${px}" y="246" width="90" height="4" fill="${theme.a}"/><rect x="${px + 98}" y="246" width="30" height="4" fill="${theme.b}"/>`);

  const box = (x, y, w, label, value, accent) =>
    `<path d="M${x + 14} ${y} H${x + w} V${y + 82} L${x + w - 14} ${y + 96} H${x} V${y + 14} Z" fill="${theme.base1}" fill-opacity="0.7" stroke="${accent}" stroke-opacity="0.8" stroke-width="1.5"/>` +
    `<text x="${x + 22}" y="${y + 32}" font-family="${FONTS.mono}" font-size="15" fill="${accent}" letter-spacing="3">${esc(label)}</text>` +
    `<text x="${x + 22}" y="${y + 72}" font-family="${FONTS.display}" font-weight="700" font-size="${value.length > 12 ? 24 : 30}" fill="#fff">${esc(value)}</text>`;
  parts.push(box(px, 284, 280, "USER ID", `#${String(data.userID).padStart(4, "0")}`, theme.a));
  parts.push(box(px + 300, 284, 330, "SALDO", data.money, theme.b));

  // Bar EXP
  const ey = 430, ew = 630;
  parts.push(`<text x="${px}" y="${ey}" font-family="${FONTS.mono}" font-size="15" fill="#fff" fill-opacity="0.75" letter-spacing="3">EXP PROGRESS</text>`);
  parts.push(`<text x="${px + ew}" y="${ey}" text-anchor="end" font-family="${FONTS.mono}" font-size="15" fill="${theme.a}" letter-spacing="2">${data.exp} / ${data.expToNext}</text>`);
  parts.push(`<path d="M${px + 8} ${ey + 14} H${px + ew} L${px + ew - 8} ${ey + 34} H${px} Z" fill="#fff" fill-opacity="0.08" stroke="#fff" stroke-opacity="0.2"/>`);
  const fill = Math.max(16, ew * progress);
  parts.push(`<path d="M${px + 8} ${ey + 14} H${f1(px + fill)} L${f1(px + fill - 8)} ${ey + 34} H${px} Z" fill="url(#bar)"/>`);
  const segs = [];
  for (let x = px + 30; x < px + ew; x += 30) segs.push(`M${x} ${ey + 14} L${x - 8} ${ey + 34}`);
  parts.push(`<path d="${segs.join(" ")}" stroke="${theme.base1}" stroke-opacity="0.6" stroke-width="2"/>`);
  parts.push(`<text x="${px}" y="${ey + 66}" font-family="${FONTS.mono}" font-size="15" fill="#fff" fill-opacity="0.6" letter-spacing="3">ROLE · ${esc(data.role)}</text>`);

  // Watermark
  parts.push(`<text x="${W - 60}" y="${H - 52}" text-anchor="end" font-family="${FONTS.display}" font-weight="900" font-size="30" letter-spacing="3" fill="${theme.a}" opacity="0.7" filter="url(#glow)">SupanigaMX</text>`);
  parts.push(`<text x="${W - 60}" y="${H - 52}" text-anchor="end" font-family="${FONTS.display}" font-weight="900" font-size="30" letter-spacing="3" fill="url(#wm)">SupanigaMX</text>`);

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs>` +
    `<linearGradient id="edge" x1="0" x2="1"><stop offset="0" stop-color="${theme.a}"/><stop offset="1" stop-color="${theme.b}"/></linearGradient>` +
    `<linearGradient id="bar" x1="0" x2="1"><stop offset="0" stop-color="${theme.a}"/><stop offset="1" stop-color="${theme.b}"/></linearGradient>` +
    `<linearGradient id="wm" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="0.55" stop-color="${theme.a}"/><stop offset="1" stop-color="${theme.b}"/></linearGradient>` +
    `<linearGradient id="streak" x1="0" x2="1"><stop offset="0" stop-color="${theme.a}" stop-opacity="0"/><stop offset="1" stop-color="#fff"/></linearGradient>` +
    `<linearGradient id="floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${theme.a}" stop-opacity="0"/><stop offset="1" stop-color="${theme.a}" stop-opacity="0.5"/></linearGradient>` +
    `<filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="7"/></filter>` +
    `</defs>${parts.join("")}</svg>`
  );
}

/**
 * @param {{ name: string, userID: number, money: number, level: number, exp: number, expToNext: number, role?: string, avatarUrl?: string|null, title?: string }} data
 * @returns {Promise<Buffer>} JPEG kartu status
 */
async function renderProfileCard(data) {
  const theme = pick(PALETTES);
  const name = fontSafe(data.name, 22, `USER ${data.userID}`);
  const info = {
    title: fontSafe(data.title || "USER STATUS", 24, "USER STATUS").toUpperCase(),
    stamp: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC",
    name,
    userID: data.userID,
    money: formatMoney(data.money),
    level: Number(data.level) || 1,
    exp: Number(data.exp) || 0,
    expToNext: Number(data.expToNext) || 100,
    role: fontSafe(data.role || "USER", 24, "USER").toUpperCase(),
  };
  const [bg, avatar] = await Promise.all([nebula(theme), fetchAvatar(data.avatarUrl).then((buf) => avatarLayer(buf, name, theme))]);
  return sharp(bg)
    .composite([{ input: svgToPng(overlay(theme, info)), left: 0, top: 0 }, { input: avatar, left: AX, top: AY }])
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
}

module.exports = { renderProfileCard, formatMoney };
