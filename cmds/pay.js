const { formatMoney } = require("./lib/profile-card");

const MESSAGES = {
  INVALID_AMOUNT: "Jumlah harus berupa bilangan bulat lebih dari 0.",
  SELF_TRANSFER: "Anda tidak dapat mengirim uang ke diri sendiri.",
  SENDER_NOT_FOUND: "Data Anda tidak ditemukan di database bot.",
  TARGET_NOT_FOUND: "Penerima tidak ditemukan.",
  INSUFFICIENT_FUNDS: "Saldo Anda tidak mencukupi.",
};

/** ".pay 12 5000" -> { id: 12, amount: 5000 }. Menerima pemisah ribuan "5.000" atau "5,000". */
function parsePayArgs(args) {
  const [rawId, rawAmount] = args;
  if (!/^#?\d{1,9}$/.test(String(rawId || ""))) return null;
  const amountText = String(rawAmount || "").replace(/[.,_]/g, "");
  if (!/^\d{1,15}$/.test(amountText)) return null;
  return { id: Number(String(rawId).replace("#", "")), amount: Number(amountText) };
}

module.exports = {
  config: {
    name: "pay",
    aliases: ["transfer"],
    cooldown: 5,
    description: "Mengirim uang kepada user lain berdasarkan ID bot",
    usage: "pay <ID user> <jumlah>, contoh: pay 12 5000",
    category: "User",
    price: 0,
    role: 0,
  },
  _parsePayArgs: parsePayArgs,
  onStart: async function ({ api, args, event, usersData, prefix }) {
    const parsed = parsePayArgs(args);
    if (!parsed) return api.reply(`Gunakan: ${prefix}pay <ID user> <jumlah>\nContoh: ${prefix}pay 12 5000`);
    const target = await usersData.getByID(parsed.id);
    if (!target) return api.reply(`User dengan ID ${parsed.id} tidak ditemukan.`);
    try {
      const { from, to } = await usersData.transfer(event.senderNumber, target.nomor, parsed.amount);
      await api.reply([
        "*Transfer Berhasil*",
        `Penerima: ${to.nama} (ID ${to.userID})`,
        `Jumlah: ${formatMoney(parsed.amount)}`,
        `Sisa saldo Anda: ${formatMoney(from.money)}`,
      ].join("\n"));
    } catch (error) {
      if (error?.code && MESSAGES[error.code]) return api.reply(`Transfer gagal: ${MESSAGES[error.code]}`);
      throw error;
    }
  },
};
