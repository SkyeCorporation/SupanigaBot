/**
 * Handler pesan masuk -> eksekusi command dan pemanggilan Esdeath tanpa prefix.
 */
import { downloadMediaMessage, normalizeMessageContent } from "baileys";
import pino from "pino";
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
const mediaLogger = pino({ level: "silent" });

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
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption ||
    content.buttonsResponseMessage?.selectedButtonId ||
    content.listResponseMessage?.singleSelectReply?.selectedRowId ||
    content.templateButtonReplyMessage?.selectedId ||
    ""
  );
}

function getContextInfo(content) {
  if (!content) return null;
  for (const value of Object.values(content)) {
    if (value && typeof value === "object" && value.contextInfo) return value.contextInfo;
  }
  return null;
}

function hasMedia(message) {
  return ["imageMessage", "videoMessage", "audioMessage", "documentMessage"].some((type) => message?.[type]);
}

function sameJid(left, right) {
  if (!left || !right) return false;
  return String(left).replace(/:\d+@/, "@").toLowerCase() === String(right).replace(/:\d+@/, "@").toLowerCase();
}

export async function handleMessage(sock, msg) {
  if (!msg?.message || msg.key?.fromMe) return;
  const chatJid = msg.key.remoteJid;
  if (!chatJid || chatJid === "status@broadcast" || chatJid.endsWith("@newsletter") || chatJid.endsWith("@broadcast")) return;

  state.stats.messages++;
  const content = normalizeMessageContent(msg.message);
  const text = getText(content).trim();
  const ctx = getContextInfo(content);
  const prefix = config.prefix;
  const commandBody = text.startsWith(prefix) ? text.slice(prefix.length).trim() : "";
  const [rawName = "", ...args] = commandBody.split(/\s+/);
  const commandName = rawName.toLowerCase();

  const isGroup = chatJid.endsWith("@g.us");
  const groupMeta = isGroup ? await getGroupMeta(sock, chatJid) : null;
  const senderJid = isGroup ? msg.key.participant : chatJid;
  const senderAlt = isGroup ? msg.key.participantAlt : msg.key.remoteJidAlt;
  const nomor = await resolveNumber(sock, senderJid, { alt: senderAlt, groupMeta });
  if (!nomor) {
    log.warn("Pesan dilewati: nomor pengirim tidak bisa dibaca dari WhatsApp");
    return;
  }

  const participant = groupMeta?.participants?.find(
    (person) => person.id === senderJid || person.lid === senderJid || normalizeNumber(person.phoneNumber) === nomor,
  );
  const isGroupAdmin = !!participant?.admin;
  const user = await usersData.getOrCreate(nomor, msg.pushName || "Unknown");
  const group = isGroup ? await groupsData.getOrCreate(chatJid, groupMeta?.subject) : null;
  const roleLevel = getRoleLevel({ number: nomor, isGroupAdmin, config });
  const allow = shouldRespond({ roleLevel, user, group, isGroup });
  if (!allow.ok) return;

  const api = createApi(sock, msg, chatJid);
  const quotedMessage = ctx?.quotedMessage
    ? {
        key: { remoteJid: chatJid, id: ctx.stanzaId, participant: ctx.participant },
        message: ctx.quotedMessage,
      }
    : null;
  const replyToBot = !!ctx?.stanzaId && sameJid(ctx.participant, sock.user?.id);
  const directEsdeath = /^esdeath\b/i.test(text);
  const esdeathCommand = commands.get("esdeath");
  const shouldCallEsdeath = !!esdeathCommand && (directEsdeath || replyToBot);
  let command = commands.get(commandName);
  let commandArgs = args;
  if (!commandBody && shouldCallEsdeath) {
    command = esdeathCommand;
    commandArgs = [];
  }

  // Pesan biasa dan command tidak dikenal diabaikan agar bot tidak spam.
  if (!command) return;
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
  const event = {
    message: msg,
    chatJid,
    isGroup,
    senderNumber: nomor,
    senderName: msg.pushName || user.nama,
    body: text,
    mentionNumbers,
    quotedNumber,
    targetNumber: mentionNumbers[0] || quotedNumber || null,
    groupMeta,
    mediaMessage: hasMedia(content) ? { ...msg, message: content } : null,
    quotedMediaMessage: quotedMessage && hasMedia(normalizeMessageContent(quotedMessage.message))
      ? { ...quotedMessage, message: normalizeMessageContent(quotedMessage.message) }
      : null,
    quotedText: quotedMessage ? getText(normalizeMessageContent(quotedMessage.message)) : "",
    replyToBot,
  };

  const where = isGroup ? `grup "${group?.groupName}" (GID ${group?.gid})` : "chat pribadi";
  log.cmd(`User #${user.userID} (${user.nama}) → ${shouldCallEsdeath ? "Esdeath AI" : `${prefix}${cfg.name}`} di ${where}`);
  state.stats.commands++;
  bus.emit("stats", state.stats);

  try {
    await command.onStart({
      api, event, message: msg, args: commandArgs, usersData, groupsData, threadsData: groupsData,
      user, group, role: roleLevel, config, prefix, commandName: cfg.name, commands: commandList,
      utils: { normalizeNumber, maskNumber, numberToJid, ROLE_NAMES, uptime: () => Date.now() - state.startedAt },
    });
  } catch (err) {
    state.stats.errors++;
    if (charged) await usersData.addMoney(nomor, charged);
    log.error(`Error di command ${cfg.name}: ${err.message}`);
    await api.reply(`⚠️ Terjadi error saat menjalankan *${prefix}${cfg.name}*.`).catch(() => {});
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
    async downloadMedia(mediaMessage) {
      return downloadMediaMessage(mediaMessage, "buffer", {}, {
        logger: mediaLogger,
        reuploadRequest: sock.updateMediaMessage,
      });
    },
    resolveNumber: (jid) => resolveNumber(sock, jid),
  };
}
