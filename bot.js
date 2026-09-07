require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { TelegramBot } = require('node-telegram-bot-api');

const token = process.env.BOT_TOKEN;
const MODERATOR_GROUP_ID = Number(process.env.MODERATOR_GROUP_ID);

if (!token || !MODERATOR_GROUP_ID) {
  console.error('Please set BOT_TOKEN and MODERATOR_GROUP_ID environment variables.');
  process.exit(1);
}

const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const DEFAULT_STATE = { bans: {}, questions: {}, antispam: {}, antiflood: {} };

const bot = new TelegramBot(token, { polling: true });
let state = loadState();

function loadState() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });

    if (!fs.existsSync(STATE_FILE)) {
      saveState();
      return { ...DEFAULT_STATE };
    }

    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      bans: parsed.bans || {},
      questions: parsed.questions || {},
      antispam: parsed.antispam || {},
      antiflood: parsed.antiflood || {},
    };
  } catch (error) {
    console.error('Failed to load state:', error.message);
    return { ...DEFAULT_STATE };
  }
}

function getAntispamSettings(chatId) {
  const key = String(chatId);
  state.antispam[key] = {
    enabled: false,
    maxMessages: 7,
    intervalSeconds: 3,
    punishment: 'allow',
    deleteMessages: true,
    ...(state.antispam[key] || {}),
  };
  return state.antispam[key];
}

function getAntifloodSettings(chatId) {
  const key = String(chatId);
  state.antiflood[key] = {
    enabled: false,
    maxCharacters: 20,
    punishment: 'mute',
    ...(state.antiflood[key] || {}),
  };
  return state.antiflood[key];
}

function punishmentDuration() {
  return Math.floor(Date.now() / 1000) + 4 * 60 * 60;
}

function applyPunishmentOptions(settings) {
  if (settings.punishment === 'mute') {
    return {
      type: 'mute',
      options: {
        can_send_messages: false,
        can_send_audios: false,
        can_send_documents: false,
        can_send_photos: false,
        can_send_videos: false,
        can_send_video_notes: false,
        can_send_voice_notes: false,
        can_send_polls: false,
        can_send_other_messages: false,
        until_date: punishmentDuration(),
      },
    };
  }
  if (settings.punishment === 'ban') {
    return { type: 'ban', options: { until_date: punishmentDuration() } };
  }
  return null;
}

function antifloodSettingsText(settings) {
  return [
    '🌊 Настройки антифлуда',
    '',
    `Состояние: ${settings.enabled ? '✅ включен' : '❌ выключен'}`,
    `Максимум символов в одном сообщении: ${settings.maxCharacters}`,
    `Наказание: ${settings.punishment === 'ban' ? '🚫 Заблокировать' : '🔇 Замутить'}`,
    'Срок наказания: 4 часа',
  ].join('\n');
}

function antifloodSettingsKeyboard(settings) {
  return {
    inline_keyboard: [
      [{ text: '🔤 Символы', callback_data: 'antiflood:characters' }],
      [{ text: settings.enabled ? '❌ Выключить антифлуд' : '✅ Включить антифлуд', callback_data: 'antiflood:toggle' }],
      [
        { text: '🔇 Мут', callback_data: 'antiflood:punishment:mute' },
        { text: '🚫 Бан', callback_data: 'antiflood:punishment:ban' },
      ],
      [{ text: '⬅️ Назад', callback_data: 'menu:main' }],
    ],
  };
}

function antifloodCharactersKeyboard() {
  const values = [5, 10, 15, 20, 25, 30, 35];
  return {
    inline_keyboard: [
      values.slice(0, 4).map((value) => ({ text: String(value), callback_data: `antiflood:set-characters:${value}` })),
      values.slice(4).map((value) => ({ text: String(value), callback_data: `antiflood:set-characters:${value}` })),
      [{ text: '⬅️ Назад', callback_data: 'menu:antiflood' }],
    ],
  };
}

function antispamSettingsText(settings) {
  const punishment = {
    allow: '❗ Исключить',
    mute: '🔇 Замутить',
    ban: '🚫 Заблокировать',
  }[settings.punishment] || '❗ Исключить';

  return [
    '🛡️ Настройки антиспама',
    '',
    `Состояние: ${settings.enabled ? '✅ включен' : '❌ выключен'}`,
    `Антиспам срабатывает при отправке ${settings.maxMessages} сообщений за ${settings.intervalSeconds} сек.`,
    `Наказание: ${punishment}`,
    `Удалять сообщения: ${settings.deleteMessages ? '✅ да' : '❌ нет'}`,
  ].join('\n');
}

function antispamSettingsKeyboard(settings) {
  return {
    inline_keyboard: [
      [
        { text: '💬 Сообщения', callback_data: 'antispam:messages' },
        { text: '🕘 Время', callback_data: 'antispam:interval' },
      ],
      [
        { text: settings.enabled ? '❌ Выключить антиспам' : '✅ Включить антиспам', callback_data: 'antispam:toggle' },
      ],
      [{ text: '🌊 Антифлуд', callback_data: 'menu:antiflood' }],
      [
        { text: '❗ Исключить', callback_data: 'antispam:punishment:allow' },
        { text: '🔇 Замутить', callback_data: 'antispam:punishment:mute' },
        { text: '🚫 Заблокировать', callback_data: 'antispam:punishment:ban' },
      ],
      [{ text: `🗑️ Удалять сообщения: ${settings.deleteMessages ? 'да' : 'нет'}`, callback_data: 'antispam:delete' }],
      [{ text: '⬅️ Назад', callback_data: 'menu:main' }],
    ],
  };
}

function numberSelectionKeyboard(type) {
  const values = [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20];
  const rows = [];
  for (let index = 0; index < values.length; index += 4) {
    rows.push(values.slice(index, index + 4).map((value) => ({
      text: String(value),
      callback_data: `antispam:${type === 'messages' ? 'set-messages' : 'set-interval'}:${value}`,
    })));
  }
  rows.push([{ text: '⬅️ Назад', callback_data: 'menu:antispam' }]);
  return { inline_keyboard: rows };
}

const antispamCounters = new Map();

function antispamCountersFor(chatId) {
  if (!antispamCounters.has(chatId)) antispamCounters.set(chatId, new Map());
  return antispamCounters.get(chatId);
}

function mainMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '🛡️ Настройки антиспама', callback_data: 'menu:antispam' }],
    ],
  };
}

async function handleAntispamMessage(msg) {
  if (msg.chat.id !== MODERATOR_GROUP_ID || !msg.from || msg.from.is_bot) return false;

  const settings = getAntispamSettings(msg.chat.id);
  if (!settings.enabled) return false;

  const now = Date.now();
  const counters = antispamCountersFor(msg.chat.id);
  const userKey = String(msg.from.id);
  const recentMessages = (counters.get(userKey) || []).filter(
    (entry) => now - entry.createdAt < settings.intervalSeconds * 1000
  );
  recentMessages.push({ createdAt: now, messageId: msg.message_id });
  counters.set(userKey, recentMessages);

  if (recentMessages.length < settings.maxMessages) return false;
  counters.delete(userKey);

  if (settings.deleteMessages) {
    await Promise.all(recentMessages.map((entry) => tryDeleteMessage(msg.chat.id, entry.messageId)));
  }

  try {
    const punishment = applyPunishmentOptions(settings);
    if (punishment?.type === 'mute') {
      await bot.restrictChatMember(msg.chat.id, msg.from.id, punishment.options);
    } else if (punishment?.type === 'ban') {
      await bot.banChatMember(msg.chat.id, msg.from.id, punishment.options);
    }
  } catch (error) {
    console.error('Failed to apply antispam punishment:', error.message);
  }

  return true;
}

async function handleAntifloodMessage(msg) {
  if (msg.chat.id !== MODERATOR_GROUP_ID || !msg.from || msg.from.is_bot) return false;

  const settings = getAntifloodSettings(msg.chat.id);
  if (!settings.enabled) return false;

  const messageText = String(msg.text || msg.caption || '');
  if (messageText.length <= settings.maxCharacters) return false;

  await tryDeleteMessage(msg.chat.id, msg.message_id);

  try {
    const punishment = applyPunishmentOptions(settings);
    if (punishment?.type === 'mute') {
      await bot.restrictChatMember(msg.chat.id, msg.from.id, punishment.options);
    } else if (punishment?.type === 'ban') {
      await bot.banChatMember(msg.chat.id, msg.from.id, punishment.options);
    }
  } catch (error) {
    console.error('Failed to apply antiflood punishment:', error.message);
  }

  return true;
}
function saveState() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function normalizeUserKey(user) {
  if (user?.username) {
    return `username:${user.username.toLowerCase()}`;
  }
  return `id:${String(user?.id)}`;
}

function banUser({ user, reason = 'manual', until = null }) {
  const key = normalizeUserKey(user);
  state.bans[key] = {
    username: user?.username || null,
    id: user?.id || null,
    reason,
    until,
    bannedAt: Date.now(),
  };
  saveState();
}

function unbanUser(user) {
  const key = normalizeUserKey(user);
  delete state.bans[key];
  saveState();
}

function isBanned(user) {
  const candidateKeys = [
    normalizeUserKey(user),
    user?.username ? `username:${String(user.username).toLowerCase()}` : null,
    user?.id ? `id:${String(user.id)}` : null,
  ].filter(Boolean);

  for (const key of candidateKeys) {
    const ban = state.bans[key];
    if (!ban) continue;
    if (ban.until && Date.now() > ban.until) {
      delete state.bans[key];
      saveState();
      continue;
    }
    return true;
  }

  return false;
}

function parseDurationToMs(value) {
  const normalized = String(value).trim().toLowerCase();
  const match = normalized.match(/^([0-9]+)\s*([a-zа-яё]+)$/i);
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const map = {
    s: 1000,
    sec: 1000,
    secs: 1000,
    second: 1000,
    seconds: 1000,
    'с': 1000,
    сек: 1000,
    секунд: 1000,
    секунда: 1000,
    секунды: 1000,
    m: 60 * 1000,
    min: 60 * 1000,
    mins: 60 * 1000,
    minute: 60 * 1000,
    minutes: 60 * 1000,
    'м': 60 * 1000,
    мин: 60 * 1000,
    минут: 60 * 1000,
    минута: 60 * 1000,
    минуты: 60 * 1000,
    h: 60 * 60 * 1000,
    hr: 60 * 60 * 1000,
    hrs: 60 * 60 * 1000,
    hour: 60 * 60 * 1000,
    hours: 60 * 60 * 1000,
    'ч': 60 * 60 * 1000,
    час: 60 * 60 * 1000,
    часа: 60 * 60 * 1000,
    часов: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    days: 24 * 60 * 60 * 1000,
    'д': 24 * 60 * 60 * 1000,
    день: 24 * 60 * 60 * 1000,
    дня: 24 * 60 * 60 * 1000,
    дней: 24 * 60 * 60 * 1000,
  };

  const ms = map[unit];
  if (!ms) return null;
  return amount * ms;
}

function extractMentionUsername(text) {
  const mentionMatch = text.match(/@([A-Za-z0-9_]+)/);
  if (mentionMatch) return mentionMatch[1].toLowerCase();
  const idMention = text.match(/<@([A-Za-z0-9_]+)>/);
  if (idMention) return idMention[1].toLowerCase();
  const mentionOnly = text.match(/(?:^|\s)([A-Za-z0-9_]+)(?:$|\s)/);
  if (mentionOnly) return mentionOnly[1].toLowerCase();
  return null;
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatBanList() {
  const entries = Object.values(state.bans);
  if (!entries.length) return 'Нет заблокированных пользователей.';
  return entries.map((ban) => {
    const username = ban.username ? `@${ban.username}` : `id:${ban.id}`;
    const until = ban.until ? ` до ${new Date(ban.until).toISOString()}` : ' навсегда';
    return `${username} — ${ban.reason}${until}`;
  }).join('\n');
}

async function summarizeUser(user) {
  const username = user?.username ? `@${user.username}` : `ID ${user.id}`;
  return username;
}

async function sendModeratorMessage(text, options = {}) {
  try {
    return await bot.sendMessage(MODERATOR_GROUP_ID, text, options);
  } catch (error) {
    console.error('Failed to send moderator group message:', error.message);
    return null;
  }
}

async function tryDeleteMessage(chatId, messageId) {
  try {
    await bot.deleteMessage(chatId, messageId);
    return true;
  } catch (error) {
    const description = String(error?.response?.description || error.message || '');
    const isPermissionIssue = /message can't be deleted|not enough rights|delete messages|not a chat admin/i.test(description);
    if (isPermissionIssue) {
      console.warn(`Cannot delete message ${chatId}/${messageId}: ${description}`);
    } else if (!/message to delete not found|message not found/i.test(description)) {
      console.error(`Failed to delete message ${chatId}/${messageId}: ${description}`);
    }
    return false;
  }
}

bot.onText(/^\/(start)(?:@[A-Za-z0-9_]+)?\b/i, async (msg) => {
  if (msg.chat.type === 'private') {
    await bot.sendMessage(
      msg.chat.id,
      '✨ Это помощник беседы БРЕДИМ.\n💬 Пишите вопросы, а наша модерация постарается ответить в кратчайшие сроки.'
    );
  }
});

bot.onText(/^\/menu(?:@[A-Za-z0-9_]+)?\b/i, async (msg) => {
  if (msg.chat.id !== MODERATOR_GROUP_ID) return;
  await bot.sendMessage(msg.chat.id, '⚙️ Главное меню', { reply_markup: mainMenuKeyboard() });
});

bot.onText(/^(?:!|\/)(h?)(бан|разбан|баны|помощь|хелп|help|ban|unban|bans)(?:@[A-Za-z0-9_]+)?(?=\s|$)/i, async (msg, match) => {
  if (msg.chat.id !== MODERATOR_GROUP_ID) {
    return;
  }

        [{ text: '🌊 Антифлуд', callback_data: 'menu:antiflood' }],
  const hasHPrefix = String(match[1] || '').toLowerCase() === 'h';
  const rawCommand = String(match[2] || '').toLowerCase();
  const command = hasHPrefix ? `h${rawCommand}` : rawCommand;
  const text = msg.text || '';

  if (command === 'help' || command === 'помощь' || command === 'хелп' || command === 'hhelp') {
    await bot.sendMessage(
      msg.chat.id,
      '🛡️ Команды для модераторов:\n🧾 !бан <@username> время причина\n🔓 !разбан <@username>\n📋 !баны\n❓ !помощь\n❔ !хелп\n\n🇬🇧 English aliases:\n🧾 /hban <@username> time reason\n🔓 /hunban <@username>\n📋 /hbans\n❓ /hhelp'
    );
    return;
  }

  if (command === 'баны' || command === 'bans' || command === 'hbans') {
    await bot.sendMessage(msg.chat.id, formatBanList());
    return;
  }

  if (rawCommand === 'ban' || rawCommand === 'unban' || rawCommand === 'bans') {
    if (!hasHPrefix && !msg.text.startsWith('!')) {
      return;
    }
  }

  if (command === 'разбан' || command === 'unban' || command === 'hunban') {
    if (!hasHPrefix && !text.startsWith('!')) {
      return;
    }

    const username = extractMentionUsername(text);
    if (!username) {
      await bot.sendMessage(msg.chat.id, '⚠️ Формат: 🔓 !разбан @username или /hunban @username');
      return;
    }

    const user = { username };
    unbanUser(user);
    await bot.sendMessage(msg.chat.id, `✅🔓 Пользователь @${username} разбанен.`);
    return;
  }

  if (command === 'бан' || command === 'ban' || command === 'hban') {
    if (!hasHPrefix && !text.startsWith('!')) {
      return;
    }
    const args = text.split(/\s+/).slice(1);
    const username = extractMentionUsername(text);
    const durationArg = args.find((item) => parseDurationToMs(item));
    const durationIndex = durationArg ? args.indexOf(durationArg) : -1;
    const reasonParts = durationIndex >= 0 ? args.slice(durationIndex + 1) : args.slice(1);
    const reason = reasonParts.join(' ') || 'без причины';

    if (!username) {
      await bot.sendMessage(
        msg.chat.id,
        '⚠️ Формат: 🧾 !бан <@username> [время] [причина] или /hban <@username> [time] [reason]'
      );
      return;
    }

    const ms = durationArg ? parseDurationToMs(durationArg) : null;
    const until = ms ? Date.now() + ms : null;

    if (durationArg && !ms) {
      await bot.sendMessage(msg.chat.id, '⏰ Некорректное время. Примеры: 10m, 1h, 1d.');
      return;
    }

    banUser({
      user: { username },
      reason,
      until,
    });

    const durationText = durationArg || 'навсегда';
    await bot.sendMessage(
      msg.chat.id,
      `⛔🚫 Пользователь @${username} заблокирован на ${durationText}. Причина: ${reason}`
    );
  }
});

bot.on('callback_query', async (callbackQuery) => {
  const data = callbackQuery.data || '';
  const messageId = callbackQuery.message?.message_id;

  if (callbackQuery.message?.chat?.id === MODERATOR_GROUP_ID && (data === 'menu:main' || data === 'menu:antispam' || data === 'menu:antiflood' || data.startsWith('antispam:') || data.startsWith('antiflood:'))) {
    const chatId = callbackQuery.message.chat.id;
    const settings = getAntispamSettings(chatId);

    if (data === 'menu:main') {
      await bot.editMessageText('⚙️ Главное меню', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: mainMenuKeyboard(),
      });
    } else if (data === 'menu:antispam') {
      await bot.editMessageText(antispamSettingsText(settings), {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: antispamSettingsKeyboard(settings),
      });
    } else if (data === 'menu:antiflood') {
      const antifloodSettings = getAntifloodSettings(chatId);
      await bot.editMessageText(antifloodSettingsText(antifloodSettings), {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: antifloodSettingsKeyboard(antifloodSettings),
      });
    } else if (data === 'antispam:messages' || data === 'antispam:interval') {
      const type = data.endsWith('messages') ? 'messages' : 'interval';
      const description = type === 'messages'
        ? 'Выберите максимальное количество сообщений:'
        : 'Выберите интервал времени в секундах:';
      await bot.editMessageText(
        `${description}\n\nАнтиспам срабатывает при отправке ${settings.maxMessages} сообщений за ${settings.intervalSeconds} сек.`,
        {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: numberSelectionKeyboard(type),
        }
      );
    } else if (data === 'antispam:toggle') {
      settings.enabled = !settings.enabled;
      saveState();
      await bot.editMessageText(antispamSettingsText(settings), {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: antispamSettingsKeyboard(settings),
      });
    } else if (data === 'antispam:delete') {
      settings.deleteMessages = !settings.deleteMessages;
      saveState();
      await bot.editMessageText(antispamSettingsText(settings), {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: antispamSettingsKeyboard(settings),
      });
    } else if (data.startsWith('antispam:punishment:')) {
      settings.punishment = data.split(':')[2];
      saveState();
      await bot.editMessageText(antispamSettingsText(settings), {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: antispamSettingsKeyboard(settings),
      });
    } else if (data.startsWith('antispam:set-messages:') || data.startsWith('antispam:set-interval:')) {
      const value = Number(data.split(':')[2]);
      if (data.startsWith('antispam:set-messages:')) settings.maxMessages = value;
      else settings.intervalSeconds = value;
      saveState();
      await bot.editMessageText(antispamSettingsText(settings), {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: antispamSettingsKeyboard(settings),
      });
    } else if (data.startsWith('antiflood:')) {
      const antifloodSettings = getAntifloodSettings(chatId);
      if (data === 'antiflood:characters') {
        await bot.editMessageText('Выберите максимальное количество символов в одном сообщении:', {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: antifloodCharactersKeyboard(),
        });
      } else if (data === 'antiflood:toggle') {
        antifloodSettings.enabled = !antifloodSettings.enabled;
        saveState();
        await bot.editMessageText(antifloodSettingsText(antifloodSettings), {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: antifloodSettingsKeyboard(antifloodSettings),
        });
      } else if (data.startsWith('antiflood:punishment:')) {
        antifloodSettings.punishment = data.split(':')[2];
        saveState();
        await bot.editMessageText(antifloodSettingsText(antifloodSettings), {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: antifloodSettingsKeyboard(antifloodSettings),
        });
      } else if (data.startsWith('antiflood:set-characters:')) {
        antifloodSettings.maxCharacters = Number(data.split(':')[2]);
        saveState();
        await bot.editMessageText(antifloodSettingsText(antifloodSettings), {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: antifloodSettingsKeyboard(antifloodSettings),
        });
      }
    }

    await bot.answerCallbackQuery(callbackQuery.id);
    return;
  }

  const question = state.questions[String(messageId)];

  if (!question) {
    await bot.answerCallbackQuery(callbackQuery.id, { text: '⚠️ Эта запись уже недоступна.' });
    return;
  }

  if (question.closed) {
    await bot.answerCallbackQuery(callbackQuery.id, { text: '📌🔒 Этот вопрос уже закрыт.' });
    return;
  }

  if (data.startsWith('answer:')) {
    const claimedBy = question.claimedBy;
    if (claimedBy && claimedBy !== callbackQuery.from.id) {
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: `🧑‍💼⏳ Этот вопрос уже взял модератор ${claimedBy}.`,
      });
      return;
    }

    question.claimedBy = callbackQuery.from.id;
    question.claimedByName = callbackQuery.from.username || `id:${callbackQuery.from.id}`;
    saveState();

    await bot.answerCallbackQuery(callbackQuery.id, {
      text: `✅ Вы взяли вопрос в работу. Теперь ответьте на это сообщение в группе.`
    });

    const claimMessage = await sendModeratorMessage(
      `🟢 Модератор ${await summarizeUser(callbackQuery.from)} взял вопрос в работу.`
    );
    if (claimMessage?.message_id) {
      question.claimedNoticeMessageId = claimMessage.message_id;
      saveState();
    }
    return;
  }

  if (data.startsWith('close:')) {
    question.closed = true;
    question.closedBy = callbackQuery.from.id;
    question.closedByName = callbackQuery.from.username || `id:${callbackQuery.from.id}`;
    saveState();

    await bot.answerCallbackQuery(callbackQuery.id, { text: '✅ Вопрос закрыт.' });
    await tryDeleteMessage(MODERATOR_GROUP_ID, question.moderatorMessageId);
    return;
  }

  if (data.startsWith('ban:')) {
    const user = { id: question.userId, username: question.userUsername };
    banUser({ user, reason: 'модератором через кнопку ban', until: null });
    await bot.answerCallbackQuery(callbackQuery.id, {
      text: `🚫 Пользователь ${await summarizeUser(user)} забанен.`,
    });
    await sendModeratorMessage(
      `🚫 Пользователь ${await summarizeUser(user)} забанен модератором ${await summarizeUser(callbackQuery.from)}.`
    );
    return;
  }
});

bot.on('message', async (msg) => {
  if (!msg.from || !msg.text && !msg.photo && !msg.sticker && !msg.video && !msg.voice && !msg.document && !msg.audio && !msg.video_note && !msg.animation && !msg.contact) {
    return;
  }

  if (msg.chat.type === 'private' && /^\/(start)\b/i.test(msg.text || '')) {
    return;
  }

  if (msg.chat.type === 'private') {
    if (isBanned(msg.from)) {
      await bot.sendMessage(msg.chat.id, '🚫⛔ Вы забанены и не можете отправлять вопросы боту.');
      return;
    }

    const hasMedia = Boolean(msg.photo || msg.sticker || msg.video || msg.voice || msg.document || msg.audio || msg.video_note || msg.animation || msg.contact);
    const questionText = `Новый вопрос от ${await summarizeUser(msg.from)}\n${escapeHtml(msg.text || msg.caption || '')}`;
    const keyboardMarkup = {
      inline_keyboard: [
        [{ text: '💬 Ответить', callback_data: `answer:${msg.message_id}` }],
        [{ text: '✅ Закрыть', callback_data: `close:${msg.message_id}` }],
        [{ text: '🚫 Забанить', callback_data: `ban:${msg.message_id}` }],
      ],
    };

    let keyboardMessage = null;

    if (hasMedia) {
      const mediaOptions = {
        caption: questionText,
        parse_mode: 'HTML',
        reply_markup: keyboardMarkup,
      };

      if (msg.photo) {
        keyboardMessage = await bot.sendPhoto(MODERATOR_GROUP_ID, msg.photo[msg.photo.length - 1].file_id, mediaOptions);
      } else if (msg.video) {
        keyboardMessage = await bot.sendVideo(MODERATOR_GROUP_ID, msg.video.file_id, mediaOptions);
      } else if (msg.document) {
        keyboardMessage = await bot.sendDocument(MODERATOR_GROUP_ID, msg.document.file_id, mediaOptions);
      } else if (msg.audio) {
        keyboardMessage = await bot.sendAudio(MODERATOR_GROUP_ID, msg.audio.file_id, mediaOptions);
      } else if (msg.voice) {
        keyboardMessage = await bot.sendVoice(MODERATOR_GROUP_ID, msg.voice.file_id, mediaOptions);
      } else if (msg.animation) {
        keyboardMessage = await bot.sendAnimation(MODERATOR_GROUP_ID, msg.animation.file_id, mediaOptions);
      } else if (msg.video_note) {
        keyboardMessage = await bot.sendVideoNote(MODERATOR_GROUP_ID, msg.video_note.file_id, { reply_markup: keyboardMarkup });
      } else if (msg.contact) {
        keyboardMessage = await bot.sendContact(MODERATOR_GROUP_ID, msg.contact.phone_number, msg.contact.first_name, {
          last_name: msg.contact.last_name,
          reply_markup: keyboardMarkup,
        });
      } else {
        keyboardMessage = await sendModeratorMessage(questionText, { parse_mode: 'HTML', reply_markup: keyboardMarkup });
      }
    } else {
      keyboardMessage = await sendModeratorMessage(questionText, { parse_mode: 'HTML', reply_markup: keyboardMarkup });
    }

    if (!keyboardMessage) {
      await bot.sendMessage(
        msg.chat.id,
        '⚠️🚫 Модерационная группа сейчас недоступна. Попробуйте позже.'
      );
      return;
    }

    await bot.sendMessage(
      msg.chat.id,
      '📨✅ Ваш вопрос отправлен. Пожалуйста, подождите ответа модерации.'
    );

    state.questions[String(keyboardMessage.message_id)] = {
      userId: msg.from.id,
      userUsername: msg.from.username || null,
      originalMessageId: msg.message_id,
      forwardedMessageId: msg.message_id,
      moderatorMessageId: keyboardMessage.message_id,
      originalQuestionText: String(msg.text || msg.caption || '').trim(),
      claimedBy: null,
      answered: false,
      closed: false,
    };
    saveState();
    return;
  }

  if (msg.chat.id !== MODERATOR_GROUP_ID) {
    return;
  }

  if (await handleAntispamMessage(msg)) {
    return;
  }

  if (await handleAntifloodMessage(msg)) {
    return;
  }

  const replyTo = msg.reply_to_message;
  if (!replyTo) {
    return;
  }

  const question = Object.values(state.questions).find((entry) => {
    return entry && entry.moderatorMessageId === replyTo.message_id;
  });

  if (!question) {
    return;
  }

  if (question.answered || question.closed) {
    await bot.sendMessage(msg.chat.id, question.closed ? '📌🔒 Этот вопрос закрыт.' : '📌✅ Этот вопрос уже был обработан.');
    return;
  }

  if (question.claimedBy && question.claimedBy !== msg.from.id) {
    await bot.sendMessage(msg.chat.id, '🧑‍💼⏳ Этот вопрос уже взят в работу другим модератором.');
    return;
  }

  let sentUserReply = false;

  try {
    const replyText = msg.text || '';
    const hasMedia = Boolean(msg.photo || msg.sticker || msg.video || msg.voice || msg.document || msg.audio || msg.video_note || msg.animation || msg.contact);

    if (hasMedia) {
      const mediaPayload = {
        chat_id: question.userId,
        reply_to_message_id: undefined,
      };

      if (msg.photo) {
        await bot.sendPhoto(question.userId, msg.photo[msg.photo.length - 1].file_id, { caption: '🟢 Модератор' });
      } else if (msg.video) {
        await bot.sendVideo(question.userId, msg.video.file_id, { caption: '🟢 Модератор' });
      } else if (msg.document) {
        await bot.sendDocument(question.userId, msg.document.file_id, { caption: '🟢 Модератор' });
      } else if (msg.audio) {
        await bot.sendAudio(question.userId, msg.audio.file_id, { caption: '🟢 Модератор' });
      } else if (msg.voice) {
        await bot.sendVoice(question.userId, msg.voice.file_id, { caption: '🟢 Модератор' });
      } else if (msg.sticker) {
        await bot.sendSticker(question.userId, msg.sticker.file_id);
      } else if (msg.animation) {
        await bot.sendAnimation(question.userId, msg.animation.file_id, { caption: '🟢 Модератор' });
      } else if (msg.video_note) {
        await bot.sendVideoNote(question.userId, msg.video_note.file_id);
      } else if (msg.contact) {
        await bot.sendContact(question.userId, msg.contact.phone_number, msg.contact.first_name, { last_name: msg.contact.last_name });
      }

      sentUserReply = true;
    } else if (replyText) {
      await bot.sendMessage(question.userId, `🟢 Модератор: "${escapeHtml(replyText)}"`, { parse_mode: 'HTML' });
      sentUserReply = true;
    } else {
      await bot.sendMessage(question.userId, '🟢 Модератор: ""');
      sentUserReply = true;
    }
  } catch (error) {
    console.error('Failed to send moderator answer to user:', error.message);
    await bot.sendMessage(msg.chat.id, '⚠️❌ Не удалось переслать ответ пользователю.');
    return;
  }

  try {
    await bot.editMessageReplyMarkup(
      { inline_keyboard: [] },
      {
        chat_id: MODERATOR_GROUP_ID,
        message_id: question.moderatorMessageId,
      }
    );
  } catch (error) {
    console.error('Failed to clear moderator keyboard:', error.message);
  }

  const summaryText = [
    '📌 Рассмотренный вопрос',
    `👤 От кого: ${question.userUsername ? `@${question.userUsername}` : `id:${question.userId}`}`,
    '💬 Вопрос:',
    `${escapeHtml(question.originalQuestionText || '—')}`,
    '🛠️ Ответ модератора',
    `🟢 Модератор: ${msg.from.username ? `@${msg.from.username}` : `id:${msg.from.id}`}`,
    '✉️ Ответ:',
    `${escapeHtml(msg.text || msg.caption || '📎 Медиа-файл')}`,
  ].join('\n');

  await sendModeratorMessage(summaryText, { parse_mode: 'HTML' });
  await tryDeleteMessage(MODERATOR_GROUP_ID, question.moderatorMessageId);

  if (question.claimedNoticeMessageId) {
    setTimeout(async () => {
      await tryDeleteMessage(MODERATOR_GROUP_ID, question.claimedNoticeMessageId);
    }, 2000);
  }

  question.answered = true;
  saveState();
  const confirmationMessage = await bot.sendMessage(msg.chat.id, '✅📬 Ответ переслан пользователю.');
  setTimeout(async () => {
    await tryDeleteMessage(msg.chat.id, confirmationMessage.message_id);
  }, 5000);
});

bot.on('polling_error', (error) => {
  console.error('Polling error:', error.message);
});

console.log('Telegram support bot started.');
