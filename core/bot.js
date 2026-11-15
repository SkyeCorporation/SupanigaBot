/**
 * Koneksi WhatsApp (Baileys) + QR ke dashboard.
 */
import fs from "node:fs";
import makeWASocket, { Browsers, DisconnectReason, useMultiFileAuthState } from "baileys";
import pino from "pino";
import QRCode from "qrcode";
import { SESSION_DIR } from "./paths.js";
import { log, rawTerminal } from "./logger.js";
import { setState, state } from "./state.js";
import * as handler from "./handler.js";
import { pnJidToNumber } from "./number.js";

let sock = null;
let reconnectTimer = null;
let manualLogout = false;

export function getSocket() {
  return sock;
}

export async function startBot() {
  clearTimeout(reconnectTimer);
  fs.mkdirSync(SESSION_DIR, { recursive: true });
  const { state: auth, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

  setState({ status: "connecting" });
  log.system("Menghubungkan ke WhatsApp…");

  sock = makeWASocket({
    auth,
    logger: pino({ level: "silent" }),
    browser: Browsers.ubuntu("Chrome"),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    cachedGroupMetadata: async (jid) => handler.cachedGroupMetadata?.(jid),
  });
  const current = sock;

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    if (current !== sock) return;
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      const dataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 360, color: { dark: "#05070d", light: "#ffffff" } });
      setState({ status: "qr", qr: dataUrl, qrUpdatedAt: Date.now() });
      log.info("QR Code baru tersedia — scan lewat Dashboard Web (WhatsApp > Perangkat tertaut).");
      QRCode.toString(qr, { type: "terminal", small: true }).then(rawTerminal).catch(() => {});
    }

    if (connection === "open") {
      const botNumber = pnJidToNumber(sock.user?.id) || null;
      setState({
        status: "connected",
        qr: null,
        botNumber,
        botName: sock.user?.name || sock.user?.verifiedName || null,
        connectedAt: Date.now(),
      });
      log.success(`Terhubung sebagai ${botNumber || "bot"}${state.botName ? ` (${state.botName})` : ""}`);
    }

    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      setState({ status: "disconnected", connectedAt: null });
      if (code === DisconnectReason.loggedOut || manualLogout) {
        manualLogout = false;
        log.warn("Sesi WhatsApp keluar. Menghapus sesi & membuat QR baru…");
        resetSession();
        setState({ botNumber: null, botName: null });
        reconnectTimer = setTimeout(startBot, 1500);
      } else {
        const delay = code === DisconnectReason.restartRequired ? 500 : 4000;
        log.warn(`Koneksi terputus (kode ${code ?? "?"}). Menyambung ulang dalam ${Math.round(delay / 1000)} detik…`);
        reconnectTimer = setTimeout(startBot, delay);
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const m of messages) {
      handler.handleMessage(current, m).catch((err) => log.error(`Handler error: ${err.message}`));
    }
  });

  sock.ev.on("groups.update", (updates) => updates.forEach((u) => u.id && handler.invalidateGroup(u.id)));
  sock.ev.on("group-participants.update", (u) => u.id && handler.invalidateGroup(u.id));

  return sock;
}

function resetSession() {
  try {
    fs.rmSync(SESSION_DIR, { recursive: true, force: true });
  } catch (err) {
    log.error(`Gagal menghapus sesi: ${err.message}`);
  }
}

/** Logout dari WhatsApp lalu munculkan QR baru (dipanggil dari dashboard). */
export async function logoutBot() {
  if (sock && state.status === "connected") {
    manualLogout = true;
    try {
      await sock.logout();
    } catch {
      /* event close akan menangani reset */
    }
    return;
  }
  const old = sock;
  sock = null; // abaikan event dari socket lama
  try {
    old?.end?.(undefined);
  } catch {
    /* sudah tertutup */
  }
  resetSession();
  setState({ status: "connecting", botNumber: null, botName: null, qr: null });
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(startBot, 1000);
}
