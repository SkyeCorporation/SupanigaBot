/**
 * SHELL — menjalankan perintah shell di server bot. Khusus Admin Bot (role 3).
 * Fitur yang sama tersedia di dashboard website (panel Shell).
 */
const MAX_REPLY = 3500;

function formatResult(command, result) {
  const output = [result.stdout, result.stderr].filter((part) => part && part.trim()).join("\n").trim() || "(tidak ada output)";
  const status = result.timedOut
    ? "dihentikan (melewati batas waktu)"
    : result.code === 0 ? "selesai (kode 0)" : `selesai (kode ${result.code ?? result.signal ?? "-"})`;
  const body = output.length > MAX_REPLY ? `${output.slice(0, MAX_REPLY)}\n... (output dipotong)` : output;
  return `*Shell* — ${status}, ${result.durationMs} ms\n$ ${command.slice(0, 200)}\n\n\`\`\`\n${body}\n\`\`\``;
}

module.exports = {
  config: {
    name: "shell",
    aliases: ["sh", "$"],
    cooldown: 0,
    description: "Menjalankan perintah shell di server bot (khusus Admin Bot)",
    usage: "shell <perintah>, contoh: shell ls -la",
    category: "Admin",
    price: 0,
    role: 3,
  },
  _formatResult: formatResult,
  onStart: async function ({ api, args, event, prefix }) {
    const raw = String(event.body || "");
    // Ambil teks asli setelah nama command agar spasi dan baris baru tetap utuh.
    const match = raw.match(/^\S+\s+([\s\S]+)$/);
    const command = (match ? match[1] : args.join(" ")).trim();
    if (!command) return api.reply(`Gunakan: ${prefix}shell <perintah>\nContoh: ${prefix}shell ls -la`);
    const { runShell } = await import("../core/shell.js");
    console.warn(`[shell] Admin ${event.senderNumber} menjalankan: ${command.slice(0, 300)}`);
    await api.typing?.(true);
    try {
      const result = await runShell(command);
      await api.reply(formatResult(command, result));
    } finally {
      await api.typing?.(false);
    }
  },
};
