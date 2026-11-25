/**
 * File manager untuk dashboard admin: menjelajah, membaca, menulis, membuat,
 * mengganti nama, menghapus, dan mengunggah file di dalam folder bot.
 * Semua path relatif terhadap ROOT. Folder dan file sensitif (sesi WhatsApp,
 * .env, database, .git, node_modules) tidak dapat diakses lewat dashboard.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { ROOT } from "./paths.js";

export const MAX_TEXT_BYTES = 1024 * 1024; // batas baca/tulis teks: 1 MB
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // batas unggah: 10 MB
const MAX_TREE_ENTRIES = 5000;

const HIDDEN_DIRS = new Set([".git", "node_modules", "session", ".cache", ".npm"]);

function fsError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

/** Path yang tidak boleh dibaca maupun diubah dari dashboard. */
export function isProtectedPath(relativePath) {
  const parts = relativePath.split("/");
  if (parts.some((part) => HIDDEN_DIRS.has(part))) return true;
  const base = parts.at(-1);
  if (/^\.env(\..+)?$/i.test(base) && base.toLowerCase() !== ".env.example") return true;
  if (parts[0] === "database" && /\.db(-.*)?$/i.test(base)) return true;
  return false;
}

/** Validasi path relatif: tanpa "..", tanpa path absolut, tanpa karakter kontrol. */
export function normalizeRelative(input, { allowRoot = false } = {}) {
  if (typeof input !== "string") throw fsError("Path tidak valid.");
  const value = input.trim().replace(/^\.\/+/, "").replace(/\/+$/, "");
  if (!value) {
    if (allowRoot) return "";
    throw fsError("Path kosong.");
  }
  if (value.length > 400) throw fsError("Path terlalu panjang.");
  if (/[\0-\x1f\\]/.test(value)) throw fsError("Path mengandung karakter yang tidak diizinkan.");
  if (value.startsWith("/") || /^[A-Za-z]:/.test(value)) throw fsError("Gunakan path relatif terhadap folder bot.");
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) throw fsError("Path tidak boleh berisi '.' atau '..'.");
  if (parts.some((part) => part.length > 180)) throw fsError("Nama file terlalu panjang.");
  if (isProtectedPath(value)) throw fsError("Path ini dilindungi dan tidak dapat diakses dari dashboard.", 403);
  return value;
}

function insideRoot(absolute) {
  return absolute === ROOT || absolute.startsWith(`${ROOT}${path.sep}`);
}

/** Mengubah path relatif menjadi absolut dan memastikan tetap di dalam ROOT. */
export function resolvePath(input, { mustExist = true, allowRoot = false } = {}) {
  const relative = normalizeRelative(input, { allowRoot });
  const absolute = path.resolve(ROOT, relative);
  if (!insideRoot(absolute)) throw fsError("Path di luar folder bot ditolak.");
  // Pastikan folder induk yang sudah ada tidak mengarah ke luar ROOT lewat symlink.
  let probe = absolute;
  while (!fs.existsSync(probe)) probe = path.dirname(probe);
  if (!insideRoot(fs.realpathSync(probe))) throw fsError("Path di luar folder bot ditolak.");
  const exists = fs.existsSync(absolute);
  if (mustExist && !exists) throw fsError("File atau folder tidak ditemukan.", 404);
  if (exists && fs.lstatSync(absolute).isSymbolicLink()) throw fsError("Symlink tidak dapat dibuka dari dashboard.");
  return { relative, absolute, exists };
}

export function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

const LANGUAGES = {
  js: "javascript", mjs: "javascript", cjs: "javascript", json: "json", ts: "javascript",
  css: "css", html: "html", htm: "html", md: "markdown", markdown: "markdown",
  sh: "shell", bash: "shell", yml: "yaml", yaml: "yaml", env: "properties", ini: "properties",
  txt: "text", log: "text", gitignore: "properties", dockerignore: "properties", npmrc: "properties",
};

export function languageOf(relativePath) {
  const base = path.posix.basename(relativePath).toLowerCase();
  if (base === "dockerfile") return "shell";
  if (base.startsWith(".env")) return "properties";
  const ext = base.includes(".") ? base.split(".").pop() : "";
  return LANGUAGES[ext] || "text";
}

const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", ico: "image/x-icon", mp3: "audio/mpeg", mp4: "video/mp4", ttf: "font/ttf", pdf: "application/pdf" };
export function mimeOf(relativePath) {
  const ext = path.posix.extname(relativePath).slice(1).toLowerCase();
  return MIME[ext] || "application/octet-stream";
}

function looksBinary(buffer) {
  const sample = buffer.subarray(0, 8000);
  if (sample.includes(0)) return true;
  // Teks UTF-8 yang valid tidak menghasilkan karakter pengganti saat didekode.
  return sample.toString("utf8").includes("\uFFFD");
}

/** Daftar datar semua file/folder di ROOT (kecuali yang dilindungi). */
export function listTree() {
  const entries = [];
  let truncated = false;
  const walk = (dirRelative) => {
    const dirAbsolute = path.join(ROOT, dirRelative);
    let items;
    try { items = fs.readdirSync(dirAbsolute, { withFileTypes: true }); } catch { return; }
    for (const item of items) {
      if (entries.length >= MAX_TREE_ENTRIES) { truncated = true; return; }
      const relative = dirRelative ? `${dirRelative}/${item.name}` : item.name;
      if (isProtectedPath(relative) || item.isSymbolicLink()) continue;
      if (item.isDirectory()) {
        entries.push({ path: relative, type: "dir" });
        walk(relative);
      } else if (item.isFile()) {
        let stat;
        try { stat = fs.statSync(path.join(dirAbsolute, item.name)); } catch { continue; }
        entries.push({ path: relative, type: "file", size: stat.size, mtime: stat.mtimeMs });
      }
    }
  };
  walk("");
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return { entries, truncated };
}

export function readFile(input) {
  const { relative, absolute } = resolvePath(input);
  const stat = fs.statSync(absolute);
  if (!stat.isFile()) throw fsError("Yang dipilih bukan file.");
  const base = { path: relative, size: stat.size, mtime: stat.mtimeMs, language: languageOf(relative), mime: mimeOf(relative) };
  if (stat.size > MAX_TEXT_BYTES) return { ...base, binary: false, tooLarge: true };
  const buffer = fs.readFileSync(absolute);
  if (looksBinary(buffer)) return { ...base, binary: true };
  const content = buffer.toString("utf8");
  return { ...base, binary: false, content, sha256: sha256(content) };
}

function atomicWrite(absolute, data, mode) {
  const temp = path.join(path.dirname(absolute), `.${path.basename(absolute)}.${crypto.randomBytes(6).toString("hex")}.tmp`);
  try {
    fs.writeFileSync(temp, data, { flag: "wx", mode: mode ?? 0o644 });
    fs.renameSync(temp, absolute);
  } catch (error) {
    try { fs.rmSync(temp, { force: true }); } catch { /* abaikan */ }
    throw error;
  }
}

/**
 * Menyimpan file teks. `expectedHash` wajib cocok dengan isi file saat ini
 * (mencegah menimpa perubahan orang lain), kecuali `force` bernilai true.
 */
export function writeFile(input, content, { expectedHash, force = false } = {}) {
  if (typeof content !== "string") throw fsError("Konten file harus berupa teks.");
  if (Buffer.byteLength(content, "utf8") > MAX_TEXT_BYTES) throw fsError(`Ukuran file maksimal ${MAX_TEXT_BYTES} byte.`, 413);
  const { relative, absolute } = resolvePath(input);
  const stat = fs.statSync(absolute);
  if (!stat.isFile()) throw fsError("Yang dipilih bukan file.");
  if (!force) {
    const current = fs.readFileSync(absolute, "utf8");
    if (sha256(current) !== expectedHash) throw fsError("File berubah sejak dibuka. Muat ulang atau timpa secara sadar.", 409);
  }
  atomicWrite(absolute, content, stat.mode & 0o777);
  const next = fs.statSync(absolute);
  return { path: relative, sha256: sha256(content), size: next.size, mtime: next.mtimeMs };
}

export function createEntry(input, type = "file", content = "") {
  const { relative, absolute, exists } = resolvePath(input, { mustExist: false });
  if (exists) throw fsError("Sudah ada file atau folder dengan nama tersebut.", 409);
  if (type === "dir") {
    fs.mkdirSync(absolute, { recursive: true });
    return { path: relative, type: "dir" };
  }
  if (typeof content !== "string" || Buffer.byteLength(content, "utf8") > MAX_TEXT_BYTES) throw fsError("Konten file tidak valid.");
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content, { flag: "wx" });
  return { path: relative, type: "file", sha256: sha256(content), size: Buffer.byteLength(content, "utf8") };
}

export function renameEntry(fromInput, toInput) {
  const from = resolvePath(fromInput);
  const to = resolvePath(toInput, { mustExist: false });
  if (to.exists) throw fsError("Tujuan sudah ada.", 409);
  if (to.relative === from.relative || to.relative.startsWith(`${from.relative}/`)) throw fsError("Folder tidak dapat dipindahkan ke dalam dirinya sendiri.");
  fs.mkdirSync(path.dirname(to.absolute), { recursive: true });
  fs.renameSync(from.absolute, to.absolute);
  return { from: from.relative, to: to.relative };
}

export function deleteEntry(input) {
  const { relative, absolute } = resolvePath(input);
  const stat = fs.statSync(absolute);
  if (stat.isDirectory()) {
    // Jangan hapus folder yang berisi path dilindungi (misalnya database/*.db).
    const hasProtected = (dir, rel) => fs.readdirSync(dir, { withFileTypes: true }).some((item) => {
      const childRel = `${rel}/${item.name}`;
      if (isProtectedPath(childRel)) return true;
      return item.isDirectory() && !item.isSymbolicLink() && hasProtected(path.join(dir, item.name), childRel);
    });
    if (hasProtected(absolute, relative)) throw fsError("Folder berisi file yang dilindungi dan tidak dapat dihapus dari dashboard.", 403);
    fs.rmSync(absolute, { recursive: true });
  } else {
    fs.rmSync(absolute);
  }
  return { path: relative };
}

export function uploadFile(input, buffer, { overwrite = false } = {}) {
  if (!Buffer.isBuffer(buffer)) throw fsError("Data unggahan tidak valid.");
  if (buffer.length > MAX_UPLOAD_BYTES) throw fsError(`Ukuran unggahan maksimal ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`, 413);
  const { relative, absolute, exists } = resolvePath(input, { mustExist: false });
  if (exists) {
    if (!overwrite) throw fsError("File dengan nama ini sudah ada.", 409);
    if (!fs.statSync(absolute).isFile()) throw fsError("Tujuan adalah folder.");
  }
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  atomicWrite(absolute, buffer);
  return { path: relative, size: buffer.length };
}

/** Menentukan jenis modul JavaScript (ESM/CommonJS) dari ekstensi dan package.json terdekat. */
export function moduleTypeOf(relativePath) {
  const ext = path.posix.extname(relativePath).toLowerCase();
  if (ext === ".mjs") return "module";
  if (ext === ".cjs") return "commonjs";
  let dir = path.dirname(path.resolve(ROOT, relativePath));
  while (insideRoot(dir)) {
    const pkg = path.join(dir, "package.json");
    if (fs.existsSync(pkg)) {
      try { return JSON.parse(fs.readFileSync(pkg, "utf8")).type === "module" ? "module" : "commonjs"; } catch { return "commonjs"; }
    }
    if (dir === ROOT) break;
    dir = path.dirname(dir);
  }
  return "commonjs";
}

/** Pemeriksaan sintaks sebelum menyimpan: JSON.parse untuk .json, `node --check` untuk JavaScript. */
export async function checkSyntax(input, content) {
  const relative = normalizeRelative(input);
  const language = languageOf(relative);
  if (path.posix.extname(relative).toLowerCase() === ".json") {
    try { JSON.parse(content); return { ok: true, checked: "json" }; } catch (error) { return { ok: false, checked: "json", message: error.message }; }
  }
  if (language !== "javascript" || /\.ts$/i.test(relative)) return { ok: true, checked: null };
  const type = moduleTypeOf(relative);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [`--input-type=${type}`, "--check", "-"], { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 10000);
    child.stderr.on("data", (chunk) => { if (stderr.length < 8000) stderr += chunk.toString("utf8"); });
    child.on("error", (error) => { clearTimeout(timer); resolve({ ok: true, checked: null, message: `Pemeriksaan dilewati: ${error.message}` }); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve({ ok: true, checked: type });
      const lines = stderr.split("\n");
      const lineMatch = lines[0]?.match(/:(\d+)$/);
      const message = lines.find((line) => /Error:/.test(line))?.trim() || "Sintaks tidak valid.";
      resolve({ ok: false, checked: type, message, line: lineMatch ? Number(lineMatch[1]) : null, detail: lines.slice(0, 5).join("\n") });
    });
    child.stdin.end(content);
  });
}
