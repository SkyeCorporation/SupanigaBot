/** .z — kartu sistem futuristik: info project & update terbaru dari update.json. */
const fs = require("node:fs");
const path = require("node:path");
const { svgToPng, esc, fontSafe, FONTS } = require("./lib/render");

const INFO_FILE = path.join(__dirname, "..", "update.json");
const W = 1280, H = 860;

function readInfo() {
  try { return JSON.parse(fs.readFileSync(INFO_FILE, "utf8")); } catch { return {}; }
}

function fmtUptime(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return `${d}D ${String(h).padStart(2, "0")}H ${String(m).padStart(2, "0")}M ${String(s % 60).padStart(2, "0")}S`;
}

const PALETTES = [
  ["#22d3ee", "#a855f7", "#0b1024"],
  ["#34d399", "#22d3ee", "#04140f"],
  ["#f472b6", "#818cf8", "#140a1e"],
  ["#fbbf24", "#f43f5e", "#170a0a"],
  ["#60a5fa", "#2dd4bf", "#06101c"],
];

function rnd(seed) { let x = seed || 1; return () => ((x = (x * 16807) % 2147483647) / 2147483647); }

function buildSvg(d) {
  const [a, b, bg] = PALETTES[Math.floor(Math.random() * PALETTES.length)];
  const r = rnd(Math.floor(Math.random() * 1e9));
  const stars = Array.from({ length: 140 }, () =>
    `<circle cx="${(r() * W).toFixed(1)}" cy="${(r() * H).toFixed(1)}" r="${(r() * 1.4 + 0.2).toFixed(2)}" fill="#fff" opacity="${(r() * 0.7 + 0.1).toFixed(2)}"/>`).join("");
  const circuits = Array.from({ length: 14 }, () => {
    const x = r() * W, y = r() * H, dx = (r() > 0.5 ? 1 : -1) * (60 + r() * 140), dy = (r() > 0.5 ? 1 : -1) * (30 + r() * 90);
    return `<path d="M${x.toFixed(0)} ${y.toFixed(0)} h${dx.toFixed(0)} l${(dy * 0.6).toFixed(0)} ${dy.toFixed(0)} h${(dx * 0.5).toFixed(0)}" stroke="${r() > 0.5 ? a : b}" stroke-width="1.4" fill="none" opacity=".35"/><circle cx="${(x + dx * 1.5 + dy * 0.6).toFixed(0)}" cy="${(y + dy).toFixed(0)}" r="3" fill="${a}" opacity=".7"/>`;
  }).join("");
  const bars = Array.from({ length: 36 }, (_, i) => {
    const h = 6 + r() * 34;
    return `<rect x="${860 + i * 10}" y="${300 - h}" width="6" height="${h.toFixed(0)}" rx="1" fill="url(#gA)" opacity="${(0.4 + r() * 0.6).toFixed(2)}"/>`;
  }).join("");
  const updates = (d.updates.length ? d.updates : ["Belum ada catatan update"]).slice(0, 6).map((u, i) => {
    const y = 470 + i * 50;
    return `<g><polygon points="96,${y - 14} 112,${y - 14} 120,${y - 6} 112,${y + 2} 96,${y + 2}" fill="${i === 0 ? a : "none"}" stroke="${a}" stroke-width="1.5"/>
      <text x="138" y="${y}" font-family="${FONTS.mono}" font-size="18" fill="${b}">${String(i + 1).padStart(2, "0")}</text>
      <text x="180" y="${y}" font-family="${FONTS.body}" font-weight="700" font-size="25" fill="#e6f1ff">${esc(fontSafe(u, 58))}</text></g>`;
  }).join("");
  const stat = (x, label, value, w = 250) => `<g transform="translate(${x},250)">
    <path d="M0 0 h${w - 18} l18 18 v70 h-${w} z" fill="#ffffff" fill-opacity=".04" stroke="${a}" stroke-opacity=".55"/>
    <rect x="0" y="0" width="4" height="88" fill="${a}"/>
    <text x="20" y="30" font-family="${FONTS.mono}" font-size="15" fill="${b}" letter-spacing="3">${esc(label)}</text>
    <text x="20" y="70" font-family="${FONTS.display}" font-weight="700" font-size="${value.length > 14 ? 22 : 28}" fill="#ffffff">${esc(value)}</text></g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="gA" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>
    <radialGradient id="neb1" cx=".8" cy=".2" r=".6"><stop offset="0" stop-color="${b}" stop-opacity=".45"/><stop offset="1" stop-color="${b}" stop-opacity="0"/></radialGradient>
    <radialGradient id="neb2" cx=".1" cy=".9" r=".6"><stop offset="0" stop-color="${a}" stop-opacity=".3"/><stop offset="1" stop-color="${a}" stop-opacity="0"/></radialGradient>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="${a}" stroke-opacity=".08"/></pattern>
    <pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="1" fill="#000" opacity=".25"/></pattern>
    <filter id="glow" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <rect width="${W}" height="${H}" fill="${bg}"/>
  <rect width="${W}" height="${H}" fill="url(#neb1)"/><rect width="${W}" height="${H}" fill="url(#neb2)"/>
  <rect width="${W}" height="${H}" fill="url(#grid)"/>
  ${stars}${circuits}
  <g transform="translate(1080,150)" opacity=".85">
    <circle r="110" fill="none" stroke="${a}" stroke-opacity=".25" stroke-width="1"/>
    <circle r="88" fill="none" stroke="url(#gA)" stroke-width="3" stroke-dasharray="40 14 6 14"/>
    <circle r="64" fill="none" stroke="${b}" stroke-opacity=".6" stroke-width="1.5" stroke-dasharray="2 6"/>
    <circle r="36" fill="${a}" fill-opacity=".12" stroke="${a}" stroke-width="2"/>
    <text y="8" text-anchor="middle" font-family="${FONTS.display}" font-weight="900" font-size="22" fill="#fff">SYS</text>
  </g>
  <!-- HUD frame -->
  <path d="M24 70 V24 H200 M${W - 200} 24 H${W - 24} V70 M24 ${H - 70} V${H - 24} H200 M${W - 200} ${H - 24} H${W - 24} V${H - 70}" stroke="url(#gA)" stroke-width="3" fill="none"/>
  <!-- kiri atas -->
  <text x="60" y="78" font-family="${FONTS.mono}" font-size="16" fill="${a}" letter-spacing="4">// SYSTEM ONLINE  ·  ${esc(new Date().toISOString().slice(0, 19).replace("T", " "))} UTC</text>
  <text x="60" y="122" font-family="${FONTS.display}" font-weight="900" font-size="38" fill="#fff" filter="url(#glow)" letter-spacing="2">SupanigaMX's <tspan fill="url(#gA)">Sistem</tspan></text>
  <text x="60" y="190" font-family="${FONTS.display}" font-weight="700" font-size="30" fill="#e6f1ff">${esc(fontSafe(d.project, 34, "Supaniga Bot"))}</text>
  <text x="60" y="222" font-family="${FONTS.mono}" font-size="16" fill="${b}" letter-spacing="3">CODENAME ${esc(fontSafe(d.codename, 20, "-").toUpperCase())}  ·  UPDATE ${esc(fontSafe(d.updatedAt, 20, "-"))}</text>
  ${stat(60, "VERSION", fontSafe(d.version, 16, "-"))}
  ${stat(330, "UPTIME", d.uptime, 300)}
  ${stat(650, "TOTAL USER", String(d.users))}
  ${bars}
  <text x="860" y="330" font-family="${FONTS.mono}" font-size="14" fill="${a}" letter-spacing="3">CMD ${d.commands} · CORE STABLE</text>
  <!-- update -->
  <text x="60" y="410" font-family="${FONTS.display}" font-weight="700" font-size="22" fill="${a}" letter-spacing="4">LATEST UPDATE</text>
  <line x1="60" y1="426" x2="${W - 60}" y2="426" stroke="url(#gA)" stroke-width="2"/>
  ${updates}
  <rect width="${W}" height="${H}" fill="url(#scan)"/>
  <!-- footer -->
  <line x1="60" y1="${H - 74}" x2="${W - 60}" y2="${H - 74}" stroke="${a}" stroke-opacity=".3"/>
  <text x="60" y="${H - 46}" font-family="${FONTS.display}" font-weight="700" font-size="15" fill="${a}" letter-spacing="3">SupanigaMX</text>
  <text x="${W - 60}" y="${H - 46}" text-anchor="end" font-family="${FONTS.mono}" font-size="15" fill="#c7d2fe" letter-spacing="2">Built by Demian</text>
</svg>`;
}

module.exports = {
  config: {
    name: "z",
    aliases: ["sistem", "update"],
    cooldown: 10,
    description: "Kartu sistem: info project, uptime, versi, total user, dan update terbaru",
    usage: "z",
    category: "Umum",
    price: 0,
    role: 0,
  },
  buildSvg,
  onStart: async function ({ api, usersData, commands, utils }) {
    const info = readInfo();
    const users = (await usersData.count().catch(() => ({ total: 0 }))).total;
    const data = {
      project: info.project, version: info.version, codename: info.codename, updatedAt: info.updatedAt,
      updates: Array.isArray(info.updates) ? info.updates : [],
      uptime: fmtUptime(utils.uptime()), users, commands: commands.length,
    };
    const png = svgToPng(buildSvg(data));
    await api.sendMessage({ image: Buffer.from(png), caption: `${data.project || "Supaniga"} ${data.version || ""}`.trim() });
  },
};
