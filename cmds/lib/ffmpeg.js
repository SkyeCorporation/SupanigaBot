/**
 * Pencari ffmpeg bersama (dipakai sticker & yta):
 * FFMPEG_PATH, @ffmpeg-installer/ffmpeg, ffmpeg sistem, lalu cache yang diunduh YTA
 * di ~/.cache/supanigabot atau tmp/bin.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");

const EXE = process.platform === "win32" ? ".exe" : "";
const ROOT_DIR = path.join(__dirname, "..", "..");
let cached = null;

function ensureExecutable(file) {
  if (process.platform === "win32") return;
  try { fs.accessSync(file, fs.constants.X_OK); } catch { try { fs.chmodSync(file, 0o755); } catch {} }
}

function works(file) {
  return new Promise((resolve) => {
    execFile(file, ["-hide_banner", "-version"], { timeout: 20000, windowsHide: true }, (error) => resolve(!error));
  });
}

function whichSync(name) {
  const exts = process.platform === "win32" ? (process.env.PATHEXT || ".EXE").split(";").filter(Boolean) : [""];
  for (const dir of String(process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const file = path.join(dir.replace(/^"|"$/g, ""), name + ext);
      try { if (fs.statSync(file).isFile()) return file; } catch {}
    }
  }
  return null;
}

function installerPath() {
  try {
    const file = require("@ffmpeg-installer/ffmpeg").path;
    if (!file || !fs.existsSync(file)) return null;
    ensureExecutable(file);
    return file;
  } catch { return null; }
}

/** Path ffmpeg yang bisa dijalankan, atau null. */
async function findFfmpeg() {
  if (cached && fs.existsSync(cached)) return cached;
  const candidates = [
    process.env.FFMPEG_PATH,
    installerPath(),
    whichSync("ffmpeg"),
    path.join(os.homedir(), ".cache", "supanigabot", `ffmpeg${EXE}`),
    path.join(ROOT_DIR, "tmp", "bin", `ffmpeg${EXE}`),
  ];
  for (const file of candidates) {
    if (file && fs.existsSync(file) && (await works(file))) {
      cached = file;
      return file;
    }
  }
  return null;
}

/** Jalankan ffmpeg dengan argumen; reject dengan pesan error ffmpeg bila gagal. */
function runFfmpeg(file, args, timeout = 120000) {
  return new Promise((resolve, reject) => {
    execFile(file, ["-hide_banner", "-loglevel", "error", "-y", ...args], { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (error, _stdout, stderr) => {
      if (error) {
        const reason = String(stderr || "").trim().split("\n").pop() || error.message;
        return reject(new Error(error.killed ? "Proses ffmpeg melewati batas waktu." : `ffmpeg: ${reason}`));
      }
      resolve();
    });
  });
}

module.exports = { findFfmpeg, runFfmpeg };
