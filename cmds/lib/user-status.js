/**
 * Kirim kartu status user (dipakai .status dan .whois).
 */
const { renderProfileCard, formatMoney } = require("./profile-card");

function roleName(user, config, normalizeNumber) {
  const inList = (list) => Array.isArray(list) && list.some((value) => normalizeNumber(value) === user.nomor);
  if (inList(config?.admin)) return "Admin Bot";
  if (inList(config?.moderator)) return "Moderator Bot";
  return "User";
}

async function sendStatusCard({ api, user, title, config, utils, roleLabel }) {
  const role = roleLabel || roleName(user, config, utils.normalizeNumber);
  await api.typing?.(true);
  try {
    const avatarUrl = await api.profilePictureUrl(user.nomor).catch(() => null);
    const image = await renderProfileCard({
      name: user.nama,
      userID: user.userID,
      money: user.money,
      level: user.level,
      exp: user.exp,
      expToNext: user.expToNext,
      role,
      avatarUrl,
      title,
    });
    const caption = [
      `*${title === "WHOIS" ? "Informasi User" : "Status User"}*`,
      `Nama: ${user.nama}`,
      `ID: ${user.userID}`,
      `Saldo: ${formatMoney(user.money)}`,
      `Level: ${user.level} (EXP ${user.exp}/${user.expToNext})`,
      `Role: ${role}`,
    ].join("\n");
    return await api.reply({ image, caption });
  } finally {
    await api.typing?.(false);
  }
}

module.exports = { sendStatusCard, roleName };
