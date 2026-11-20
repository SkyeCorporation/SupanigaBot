/**
 * .rhist - Reset history chat Esdeath AI berdasarkan nomor pengirim.
 * Role: 0 (semua orang boleh pakai)
 */
const fs = require("node:fs");
const path = require("node:path");

const HISTORY_PATH = path.resolve(__dirname, "..", "historyAI.json");

function loadHistory() {
  try {
    const parsed = JSON.parse(fs.readFileSync(HISTORY_PATH, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function saveHistory(history) {
  const tempPath = `${HISTORY_PATH}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(history, null, 2), "utf8");
  fs.renameSync(tempPath, HISTORY_PATH);
}

module.exports = {
  config: {
    name: "rhist",
    aliases: ["resethistory", "resethist", "clearhist"],
    cooldown: 5,
    description: "Reset history percakapan Esdeath AI milikmu",
    usage: "rhist",
    category: "AI",
    price: 0,
    role: 0, // semua orang boleh pakai
  },

  async onStart({ api, event }) {
    try {
      const history = loadHistory();
      const senderNumber = String(event.senderNumber || "").replace(/\D/g, "");
      const chatJid = event.chatJid;

      // Key yang dipakai di esdeath.js → `${chatJid}:${senderNumber}`
      const historyKey = `${chatJid}:${event.senderNumber}`;

      // Cari semua key yang mengandung nomor pengirim (baik di grup maupun private)
      let deletedCount = 0;
      for (const key of Object.keys(history)) {
        if (key.includes(senderNumber) || key === historyKey) {
          delete history[key];
          deletedCount++;
        }
      }

      saveHistory(history);

      if (deletedCount > 0) {
        await api.reply(`History chat Esdeath milikmu berhasil direset.\nTotal ${deletedCount} percakapan dihapus.`);
      } else {
        await api.reply("Tidak ada history chat yang ditemukan untuk nomor ini.");
      }
    } catch (error) {
      console.error("[rhist]", error);
      await api.reply("Gagal mereset history. Coba lagi nanti.");
    }
  },
};
