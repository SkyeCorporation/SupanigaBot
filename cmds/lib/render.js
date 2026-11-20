/**
 * Render SVG ke PNG memakai @resvg/resvg-js dengan font bawaan di ./assets/fonts,
 * sehingga hasil teks identik di semua hosting tanpa bergantung pada font sistem.
 */
const fs = require("node:fs");
const path = require("node:path");

const FONT_DIR = path.join(__dirname, "..", "..", "assets", "fonts");
const FONT_FILES = fs.existsSync(FONT_DIR)
  ? fs.readdirSync(FONT_DIR).filter((name) => name.endsWith(".ttf")).map((name) => path.join(FONT_DIR, name))
  : [];

const FONTS = Object.freeze({
  display: "Orbitron",
  body: "Rajdhani",
  mono: "Share Tech Mono",
});

let ResvgClass = null;
function resvg() {
  if (!ResvgClass) ResvgClass = require("@resvg/resvg-js").Resvg;
  return ResvgClass;
}

/** Render string SVG menjadi buffer PNG. */
function svgToPng(svg) {
  const Resvg = resvg();
  const instance = new Resvg(String(svg), {
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: FONTS.body },
    shapeRendering: 2,
    textRendering: 1,
    imageRendering: 0,
  });
  return instance.render().asPng();
}

/** Escape teks untuk disisipkan ke SVG. */
function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Bersihkan teks agar hanya berisi karakter yang tersedia di font bawaan
 * (Latin dasar & Latin Extended). Karakter lain (emoji, aksara non-Latin) dihapus.
 */
function fontSafe(value, max = 40, fallback = "") {
  const cleaned = String(value ?? "")
    .normalize("NFKC")
    .replace(/[^\u0020-\u007E\u00A0-\u024F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const sliced = cleaned.length > max ? `${cleaned.slice(0, max - 1).trim()}…` : cleaned;
  return sliced || fallback;
}

module.exports = { svgToPng, esc, fontSafe, FONTS, FONT_FILES };
