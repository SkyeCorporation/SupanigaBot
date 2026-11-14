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
  onStart: async function ({ api, commands, role, prefix, user, utils, args }) {
    const targetName = args[0]?.toLowerCase();
    if (targetName) {
      const target = commands.find((command) =>
        command.config.name === targetName || command.config.aliases.includes(targetName),
      );
      if (!target || target.config.role > role) {
        return api.reply(`Command *${targetName}* tidak ditemukan atau kamu tidak memiliki akses.`);
      }
      const command = target.config;
      const price = command.price > 0 ? `${command.price.toLocaleString("id-ID")}` : "Gratis";
      const cooldown = command.cooldown > 0 ? `${command.cooldown} detik` : "Tidak ada";
      const aliases = command.aliases.length ? `\n• *Alias*: ${command.aliases.map((alias) => `${prefix}${alias}`).join(", ")}` : "";
      return api.reply([
        "# *Command Information*",
        "",
        `• *Name*: ${command.name}`,
        `• *Price*: ${price}`,
        `• *Cooldown*: ${cooldown}`,
        `• *Description*: ${command.description || "Tidak ada deskripsi"}`,
        `• *Category*: ${command.category}`,
        `• *Usage*: ${prefix}${command.usage || command.name}`,
        aliases,
      ].filter(Boolean).join("\n"));
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
      `${prefix}help [nama command], ${prefix}menu [nama command]`,
    ];
    for (const [category, names] of [...categories.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      lines.push("", `• *${category}*`, names.map((name) => `${prefix}${name}`).join(", "));
    }
    lines.push("", "_Supaniga MX's Penguin Project 1.0.0_", `Halo *${user.nama}* • Role: ${utils.ROLE_NAMES[role]}`);
    await api.reply(lines.join("\n"));
  },
};
