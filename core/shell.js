/**
 * Eksekusi perintah shell untuk admin bot (command .shell) dan dashboard website.
 * Perintah dijalankan di folder root bot dengan batas waktu dan batas ukuran output.
 * Matikan fitur ini dengan environment variable DISABLE_SHELL=1.
 */
import { spawn } from "node:child_process";
import { ROOT } from "./paths.js";

export const SHELL_TIMEOUT_MS = 60 * 1000;
export const SHELL_MAX_OUTPUT = 512 * 1024;

export function shellEnabled() {
  return !/^(1|true|yes)$/i.test(String(process.env.DISABLE_SHELL || ""));
}

/**
 * @param {string} command
 * @param {{ timeoutMs?: number, cwd?: string }} [options]
 * @returns {Promise<{ code: number|null, signal: string|null, stdout: string, stderr: string, timedOut: boolean, truncated: boolean, durationMs: number }>}
 */
export function runShell(command, { timeoutMs = SHELL_TIMEOUT_MS, cwd = ROOT } = {}) {
  const text = String(command || "").trim();
  if (!text) return Promise.reject(new Error("Perintah shell kosong."));
  if (!shellEnabled()) return Promise.reject(new Error("Fitur shell dinonaktifkan (DISABLE_SHELL)."));
  const started = Date.now();
  return new Promise((resolve) => {
    const isWin = process.platform === "win32";
    const child = spawn(isWin ? "cmd.exe" : "/bin/sh", isWin ? ["/d", "/s", "/c", text] : ["-c", text], {
      cwd,
      env: process.env,
      windowsHide: true,
      detached: !isWin,
    });
    let stdout = "", stderr = "", size = 0, truncated = false, timedOut = false;
    const collect = (target) => (chunk) => {
      if (size >= SHELL_MAX_OUTPUT) { truncated = true; return; }
      const part = chunk.toString("utf8").slice(0, SHELL_MAX_OUTPUT - size);
      size += part.length;
      if (target === "out") stdout += part; else stderr += part;
    };
    child.stdout.on("data", collect("out"));
    child.stderr.on("data", collect("err"));
    const kill = () => {
      try { if (!isWin) process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch {} }
    };
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
    const finish = (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal: signal || null, stdout, stderr, timedOut, truncated, durationMs: Date.now() - started });
    };
    child.on("error", (error) => { stderr += String(error.message || error); finish(null, null); });
    child.on("close", finish);
  });
}
