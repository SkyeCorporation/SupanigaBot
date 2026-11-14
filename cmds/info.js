function fmt(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return `${d}h ${h}j ${m}m ${s % 60}d`;
}

module.exports = {
  config: {
    name: "info",
    aliases: ["about"],
    cooldown: 10,
    description: "Informasi bot & pembuat",
    price: 0,
    role: 0,
  },
  onStart: async function ({ api, commands, prefix, utils }) {
    await api.reply(
      [
        "🐧 *Supaniga MX's — Penguin 1.0.0 Pro*",
        "Bot WhatsApp NodeJS • Baileys • Database SQL",
        "",
        `⏱️ Uptime: ${fmt(utils.uptime())}`,
        `📦 Command: ${commands.length}`,
        `🔣 Prefix: ${prefix}`,
        "",
        "👨‍💻 *Fullstack Developer: Demian (Luxion)*",
      ].join("\n"),
    );
  },
};
