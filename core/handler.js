/**
 * Handler pesan masuk -> eksekusi command.
 */
import { normalizeMessageContent } from "baileys";
import { config } from "./config.js";
import { commands, commandList } from "./commands.js";
import { usersData, groupsData } from "./database.js";
import { log } from "./logger.js";
import { resolveNumber, numberToJid, normalizeNumber, maskNumber } from "./number.js";
import { getRoleLevel, shouldRespond, hasPermission, isFreeOfCharge, ROLE_NAMES } from "./permissions.js";
import { state, bus } from "./state.js";

const cooldowns = new Map();
const groupCache = new Map();
const GROUP_TTL = 5 * 60 * 1000;

export async function getGroupMeta(sock, jid, force = false) {
  const cached = groupCache.get(jid);
  if (!force && cached && Date.now() - cached.at < GROUP_TTL) return cached.data;
  try {
    const data = await sock.groupMetadata(jid);
    groupCache.set(jid, { data, at: Date.now() });
    return data;
  } catch {
    return cached?.data || null;
  }
}

export function invalidateGroup(jid) {
  groupCache.delete(jid);
}

export function cachedGroupMetadata(jid) {
  return groupCache.get(jid)?.data;
}

function getText(content) {
  if (!content) return "";
  return (
    content.conversation || content.extendedTextMessage?.text ||
    content.imageMessage?.caption || content.videoMessage?.caption ||
    content.documentMessage?.caption || content.buttonsResponseMessage?.selectedButtonId ||
    content.listResponseMessage?.singleSelectReply?.selectedRowId ||
    content.templateButtonReplyMessage?.selectedId || ""
  );
}

function getContextInfo(content) {
  if (!content) return null;
  for (const value of Object.values(content)) {
    if (value && typeof value === "object" && value.contextInfo) return value.contextInfo;
  }
  return null;
}

function errorText(error) {
  return String(error?.message || error || "Kesalahan tidak diketahui").replace(/[\r\n\t]+/g, " ").slice(0, 700);
}

export async function handleMessage(sock, msg) {
  if (!msg?.message || msg.key?.fromMe) return;
  const chatJid = msg.key.remoteJid;
  if (!chatJid || chatJid === "status@broadcast" || chatJid.endsWith("@newsletter") || chatJid.endsWith("@broadcast")) return;

  state.stats.messages++;
  const content = normalizeMessageContent(msg.message);
  const text = getText(content).trim();
  const prefix = config.prefix;
  const isCommand = text.startsWith(prefix);
  const body = isCommand ? text.slice(prefix.length).trim() : "";
  if (isCommand && !body) return;
  const [rawName, ...args] = body ? body.split(/\s+/) : [];
  const commandName = rawName?.toLowerCase();

  const isGroup = chatJid.endsWith("@g.us");
  const groupMeta = isGroup ? await getGroupMeta(sock, chatJid) : null;
  const senderJid = isGroup ? msg.key.participant : chatJid;
  const senderAlt = isGroup ? msg.key.participantAlt : msg.key.remoteJidAlt;
  const nomor = await resolveNumber(sock, senderJid, { alt: senderAlt, groupMeta });
  if (!nomor) {
    if (isCommand) log.warn("Pesan dilewati: nomor pengirim tidak bisa dibaca dari WhatsApp");
    return;
  }

  const participant = groupMeta?.participants?.find(
    (item) => item.id === senderJid || item.lid === senderJid || normalizeNumber(item.phoneNumber) === nomor,
  );
  const isGroupAdmin = !!participant?.admin;
  const user = await usersData.getOrCreate(nomor, msg.pushName || "Unknown");
  const group = isGroup ? await groupsData.getOrCreate(chatJid, groupMeta?.subject) : null;
  const roleLevel = getRoleLevel({ number: nomor, isGroupAdmin, config });
  const allow = shouldRespond({ roleLevel, user, group, isGroup });
  if (!allow.ok) return;

  const ctx = getContextInfo(content);
  const api = createApi(sock, msg, chatJid);
  const quotedMessageId = ctx?.stanzaId || null;
  const event = {
    message: msg,
    chatJid,
    isGroup,
    senderNumber: nomor,
    senderName: msg.pushName || user.nama,
    body: text,
    mentionNumbers: [],
    quotedNumber: null,
    targetNumber: null,
    groupMeta,
    quotedMessageId,
    replyToBot: false,
  };

  // Match by the quoted message ID tracked by the command. Do not compare
  // participant JIDs: Baileys may represent the bot with a PN or LID JID.
  if (!isCommand && quotedMessageId) {
    for (const replyCommand of commandList) {
      if (typeof replyCommand.hasPendingSelection !== "function") continue;
      let pending = false;
      try {
        pending = replyCommand.hasPendingSelection(chatJid, nomor, quotedMessageId);
      } catch (error) {
        log.error(`Gagal memeriksa balasan ${replyCommand.config.name}: ${errorText(error)}`);
      }
      if (!pending) continue;
      try {
        event.replyToBot = true; // YTA uses this flag after selection has been matched.
        if (typeof replyCommand.onReply === "function") {
          const handled = await replyCommand.onReply({ api, event, text, quotedMessageId });
          if (handled !== false) return;
        } else {
          await replyCommand.onStart({ api, event, args: [], prefix, commandName: replyCommand.config.name });
          return;
        }
      } catch (error) {
        const detail = errorText(error);
        log.error(`Error di balasan ${replyCommand.config.name}: ${detail}`);
        await api.reply(`❌ Error ${replyCommand.config.name}: ${detail}`).catch(() => {});
        return;
      }
    }
  }

  if (!isCommand) return;
  const command = commands.get(commandName);
  const where = isGroup ? `grup "${group?.groupName}" (GID ${group?.gid})` : "chat pribadi";
  if (!command) {
    await api.reply(`❔ Command *${prefix}${commandName}* tidak ditemukan.\nKetik *${prefix}menu* untuk melihat daftar command.`);
    return;
  }
  const cfg = command.config;
  if (!hasPermission(roleLevel, cfg.role)) {
    await api.reply(`⛔ Command ini khusus *${ROLE_NAMES[cfg.role]}* (role ${cfg.role}).`);
    return;
  }

  const cdKey = `${cfg.name}:${nomor}`;
  if (roleLevel < 3 && cfg.cooldown > 0) {
    const last = cooldowns.get(cdKey) || 0;
    const left = last + cfg.cooldown * 1000 - Date.now();
    if (left > 0) {
      await api.reply(`⏳ Tunggu *${Math.ceil(left / 1000)} detik* lagi untuk memakai *${prefix}${cfg.name}*.`);
      return;
    }
  }

  let charged = 0;
  if (cfg.price > 0 && !isFreeOfCharge(roleLevel)) {
    if (user.money < cfg.price) {
      await api.reply(`💸 Saldo kamu kurang. Harga *${prefix}${cfg.name}*: ${cfg.price.toLocaleString("id-ID")} • Saldo: ${user.money.toLocaleString("id-ID")}`);
      return;
    }
    await usersData.subtractMoney(nomor, cfg.price);
    charged = cfg.price;
  }
  cooldowns.set(cdKey, Date.now());

  const mentionNumbers = [];
  for (const jid of ctx?.mentionedJid || []) {
    const number = await resolveNumber(sock, jid, { groupMeta });
    if (number) mentionNumbers.push(number);
  }
  const quotedNumber = ctx?.participant ? await resolveNumber(sock, ctx.participant, { groupMeta }) : null;
  Object.assign(event, { mentionNumbers, quotedNumber, targetNumber: mentionNumbers[0] || quotedNumber || null });

  log.cmd(`User #${user.userID} (${user.nama}) → ${prefix}${cfg.name} di ${where}`);
  state.stats.commands++;
  bus.emit("stats", state.stats);
  try {
    await command.onStart({
      api, event, message: msg, args, usersData, groupsData, threadsData: groupsData,
      user, group, role: roleLevel, config, prefix, commandName: cfg.name,
      commands: commandList,
      utils: { normalizeNumber, maskNumber, numberToJid, ROLE_NAMES, uptime: () => Date.now() - state.startedAt },
    });
  } catch (error) {
    state.stats.errors++;
    if (charged) await usersData.addMoney(nomor, charged);
    const detail = errorText(error);
    log.error(`Error di command ${cfg.name}: ${detail}`);
    await api.reply(`❌ Error ${cfg.name}: ${detail}`).catch(() => {});
  }
}

function toContent(content) {
  return typeof content === "string" ? { text: content } : content;
}

export function createApi(sock, msg, chatJid) {
  return {
    sock,
    chatJid,
    async sendMessage(content, to = chatJid, options = {}) {
      const jid = typeof to === "string" && to.includes("@") ? to : numberToJid(to) || chatJid;
      return sock.sendMessage(jid, toContent(content), options);
    },
    async reply(content) {
      return sock.sendMessage(chatJid, toContent(content), { quoted: msg });
    },
    async react(emoji) {
      return sock.sendMessage(chatJid, { react: { text: emoji, key: msg.key } });
    },
    async getGroupMeta(jid = chatJid, force = false) {
      return getGroupMeta(sock, jid, force);
    },
    resolveNumber: (jid) => resolveNumber(sock, jid),
  };
}
