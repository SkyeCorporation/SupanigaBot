import { EventEmitter } from "node:events";

/** State runtime bersama antara bot dan dashboard. */
export const bus = new EventEmitter();
bus.setMaxListeners(100);

export const state = {
  status: "starting", // starting | qr | connecting | connected | disconnected
  qr: null, // data URL gambar QR
  qrUpdatedAt: null,
  botNumber: null, // hanya nomor bot yang terhubung
  botName: null,
  connectedAt: null,
  startedAt: Date.now(),
  stats: { messages: 0, commands: 0, errors: 0 },
};

export function setState(patch) {
  Object.assign(state, patch);
  bus.emit("status", publicStatus());
}

export function publicStatus() {
  return {
    status: state.status,
    qr: state.qr,
    qrUpdatedAt: state.qrUpdatedAt,
    botNumber: state.botNumber,
    botName: state.botName,
    connectedAt: state.connectedAt,
    startedAt: state.startedAt,
    stats: state.stats,
  };
}
