module.exports = {
  config: {
    name: "menu",
    aliases: ["help"],
    cooldown: 5,
    description: "Daftar command berdasarkan kategori atau detail command",
    usage: "menu [nama command]",
    category: "Helper",
    price: 0,
    role: 0,
  },
  onStart: async function ({ api, commands, role, prefix, args }) {
    const targetName = args[0]?.toLowerCase();
    if (targetName) {
      const target = commands.find((command) =>
        command.config.name === targetName || command.config.aliases.includes(targetName),
      );
      if (!target || target.config.role > role) {
        return api.reply(`Command *${targetName}* tidak ditemukan atau kamu tidak memiliki akses.`);
      }
      const command = target.config;
      return api.reply([
        "# *Command Information*",
        "",
        `• *Name*: ${command.name}`,
        `• *Price*: ${command.price > 0 ? command.price.toLocaleString("id-ID") : "Gratis"}`,
        `• *Cooldown*: ${command.cooldown > 0 ? `${command.cooldown} detik` : "Tidak ada"}`,
        `• *Description*: ${command.description || "Tidak ada deskripsi"}`,
      ].join("\n"));
    }

    const categories = new Map();
    for (const command of commands) {
      if (command.config.role > role || ["menu", "help"].includes(command.config.name)) continue;
      const category = command.config.category || "Umum";
      if (!categories.has(category)) categories.set(category, []);
      categories.get(category).push(command.config.name);
    }

    const lines = [
      "# *List Command*",
      "",
      "• *Helper*",
      `${prefix}help, ${prefix}menu`,
    ];
    for (const [category, names] of [...categories.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      lines.push("", `• *${category}*`, names.join(", "));
    }
    lines.push("", "_Supaniga MX's Penguin Project 1.0.0_");
    await api.reply(lines.join("\n"));
  },
};
