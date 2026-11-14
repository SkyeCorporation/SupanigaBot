module.exports = {
  config: {
    name: "menu",
    aliases: ["help"],
    cooldown: 5,
    description: "Daftar command sesuai role kamu",
    price: 0,
    role: 0,
  },
  onStart: async function ({ api, commands, role, prefix, user, utils }) {
    const groups = {};
    for (const c of commands) {
      if (c.config.role > role) continue;
      (groups[c.config.role] ||= []).push(c.config);
    }
    let text = `🐧 *Supaniga MX's — Penguin 1.0.0 Pro*\n`;
    text += `Halo *${user.nama}* • Role: ${utils.ROLE_NAMES[role]}\n`;
    text += `Prefix: *${prefix}*\n`;
    for (const r of Object.keys(groups).sort()) {
      text += `\n*╭─ ${utils.ROLE_NAMES[r]}*\n`;
      for (const c of groups[r]) {
        const price = c.price > 0 ? ` 💰${c.price.toLocaleString("id-ID")}` : "";
        text += `│ ${prefix}${c.name}${price} — ${c.description}\n`;
      }
      text += `╰────────\n`;
    }
    text += `\n_Fullstack Developer: Demian (Luxion)_`;
    await api.reply(text);
  },
};
