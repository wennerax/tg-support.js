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
const DEFAULT_STATE = { bans: {}, questions: {} };

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
    };
  } catch (error) {
    console.error('Failed to load state:', error.message);
    return { ...DEFAULT_STATE };
  }
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

bot.onText(/^\/(start)\b/i, async (msg) => {
  if (msg.chat.type === 'private') {
    await bot.sendMessage(
      msg.chat.id,
      '✨ Это помощник беседы БРЕДИМ.\n💬 Пишите вопросы, а наша модерация постарается ответить в кратчайшие сроки.'
    );
  }
});

bot.onText(/^(?:!|\/)(b?)(бан|разбан|баны|помощь|help|ban|unban|bans)(?=\s|$)/i, async (msg, match) => {
  if (msg.chat.id !== MODERATOR_GROUP_ID) {
    return;
  }

  const hasBPrefix = String(match[1] || '').toLowerCase() === 'b';
  const rawCommand = String(match[2] || '').toLowerCase();
  const command = hasBPrefix ? `b${rawCommand}` : rawCommand;
  const text = msg.text || '';

  if (command === 'help' || command === 'помощь' || command === 'bhelp') {
    await bot.sendMessage(
      msg.chat.id,
      '🛡️ Команды для модераторов:\n!бан <@username> время причина\n!разбан <@username>\n!баны\n!help\n\n🇬🇧 English aliases:\n/bban <@username> time reason\n/bunban <@username>\n/bbans\n/bhelp'
    );
    return;
  }

  if (command === 'баны' || command === 'bans' || command === 'bbans') {
    await bot.sendMessage(msg.chat.id, formatBanList());
    return;
  }

  if (rawCommand === 'ban' || rawCommand === 'unban' || rawCommand === 'bans') {
    if (!hasBPrefix && !msg.text.startsWith('!')) {
      return;
    }
  }

  if (command === 'разбан' || command === 'unban' || command === 'bunban') {
    if (!hasBPrefix && !text.startsWith('!')) {
      return;
    }

    const username = extractMentionUsername(text);
    if (!username) {
      await bot.sendMessage(msg.chat.id, '⚠️ Формат: !разбан @username или /bunban @username');
      return;
    }

    const user = { username };
    unbanUser(user);
    await bot.sendMessage(msg.chat.id, `✅ Пользователь @${username} разбанен.`);
    return;
  }

  if (command === 'бан' || command === 'ban' || command === 'bban') {
    if (!hasBPrefix && !text.startsWith('!')) {
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
        '⚠️ Формат: !бан <@username> [время] [причина] или /bban <@username> [time] [reason]'
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
      `⛔ Пользователь @${username} заблокирован на ${durationText}. Причина: ${reason}`
    );
  }
});

bot.on('callback_query', async (callbackQuery) => {
  const data = callbackQuery.data || '';
  const messageId = callbackQuery.message?.message_id;
  const question = state.questions[String(messageId)];

  if (!question) {
    await bot.answerCallbackQuery(callbackQuery.id, { text: 'Эта запись уже недоступна.' });
    return;
  }

  if (question.closed) {
    await bot.answerCallbackQuery(callbackQuery.id, { text: 'Этот вопрос уже закрыт.' });
    return;
  }

  if (data.startsWith('answer:')) {
    const claimedBy = question.claimedBy;
    if (claimedBy && claimedBy !== callbackQuery.from.id) {
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: `Этот вопрос уже взял модератор ${claimedBy}.`,
      });
      return;
    }

    question.claimedBy = callbackQuery.from.id;
    question.claimedByName = callbackQuery.from.username || `id:${callbackQuery.from.id}`;
    saveState();

    await bot.answerCallbackQuery(callbackQuery.id, {
      text: `Вы взяли вопрос в работу. Теперь ответьте на это сообщение в группе.`
    });

    await sendModeratorMessage(
      `Модератор ${await summarizeUser(callbackQuery.from)} взял вопрос в работу.`
    );
    return;
  }

  if (data.startsWith('close:')) {
    question.closed = true;
    question.closedBy = callbackQuery.from.id;
    question.closedByName = callbackQuery.from.username || `id:${callbackQuery.from.id}`;
    saveState();

    await bot.answerCallbackQuery(callbackQuery.id, { text: 'Вопрос закрыт.' });
    try {
      await bot.deleteMessage(MODERATOR_GROUP_ID, question.moderatorMessageId);
    } catch (error) {
      console.error('Failed to delete closed question message:', error.message);
    }
    return;
  }

  if (data.startsWith('ban:')) {
    const user = { id: question.userId, username: question.userUsername };
    banUser({ user, reason: 'модератором через кнопку ban', until: null });
    await bot.answerCallbackQuery(callbackQuery.id, {
      text: `Пользователь ${await summarizeUser(user)} забанен.`,
    });
    await sendModeratorMessage(
      `Пользователь ${await summarizeUser(user)} забанен модератором ${await summarizeUser(callbackQuery.from)}.`
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
      await bot.sendMessage(msg.chat.id, '🚫 Вы забанены и не можете отправлять вопросы боту.');
      return;
    }

    const hasMedia = Boolean(msg.photo || msg.sticker || msg.video || msg.voice || msg.document || msg.audio || msg.video_note || msg.animation || msg.contact);
    const questionText = `Новый вопрос от ${await summarizeUser(msg.from)}\n${escapeHtml(msg.text || msg.caption || '')}`;
    const keyboardMarkup = {
      inline_keyboard: [
        [{ text: 'Ответить', callback_data: `answer:${msg.message_id}` }],
        [{ text: 'Закрыть', callback_data: `close:${msg.message_id}` }],
        [{ text: 'Забанить', callback_data: `ban:${msg.message_id}` }],
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
        '⚠️ Модерационная группа сейчас недоступна. Попробуйте позже.'
      );
      return;
    }

    await bot.sendMessage(
      msg.chat.id,
      '📨 Ваш вопрос отправлен. Пожалуйста, подождите ответа модерации.'
    );

    state.questions[String(keyboardMessage.message_id)] = {
      userId: msg.from.id,
      userUsername: msg.from.username || null,
      originalMessageId: msg.message_id,
      forwardedMessageId: msg.message_id,
      moderatorMessageId: keyboardMessage.message_id,
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
    await bot.sendMessage(msg.chat.id, question.closed ? '📌 Этот вопрос закрыт.' : '📌 Этот вопрос уже был обработан.');
    return;
  }

  if (question.claimedBy && question.claimedBy !== msg.from.id) {
    await bot.sendMessage(msg.chat.id, '🧑‍💼 Этот вопрос уже взят в работу другим модератором.');
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
        await bot.sendPhoto(question.userId, msg.photo[msg.photo.length - 1].file_id, { caption: 'Модератор' });
      } else if (msg.video) {
        await bot.sendVideo(question.userId, msg.video.file_id, { caption: 'Модератор' });
      } else if (msg.document) {
        await bot.sendDocument(question.userId, msg.document.file_id, { caption: 'Модератор' });
      } else if (msg.audio) {
        await bot.sendAudio(question.userId, msg.audio.file_id, { caption: 'Модератор' });
      } else if (msg.voice) {
        await bot.sendVoice(question.userId, msg.voice.file_id, { caption: 'Модератор' });
      } else if (msg.sticker) {
        await bot.sendSticker(question.userId, msg.sticker.file_id);
      } else if (msg.animation) {
        await bot.sendAnimation(question.userId, msg.animation.file_id, { caption: 'Модератор' });
      } else if (msg.video_note) {
        await bot.sendVideoNote(question.userId, msg.video_note.file_id);
      } else if (msg.contact) {
        await bot.sendContact(question.userId, msg.contact.phone_number, msg.contact.first_name, { last_name: msg.contact.last_name });
      }

      sentUserReply = true;
    } else if (replyText) {
      await bot.sendMessage(question.userId, `Модератор: "${escapeHtml(replyText)}"`, { parse_mode: 'HTML' });
      sentUserReply = true;
    } else {
      await bot.sendMessage(question.userId, 'Модератор: ""');
      sentUserReply = true;
    }
  } catch (error) {
    console.error('Failed to send moderator answer to user:', error.message);
    await bot.sendMessage(msg.chat.id, '⚠️ Не удалось переслать ответ пользователю.');
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

  if (sentUserReply) {
    try {
      await bot.deleteMessage(MODERATOR_GROUP_ID, question.moderatorMessageId);
    } catch (error) {
      console.error('Failed to delete moderator question message:', error.message);
    }
  }

  question.answered = true;
  saveState();
  await bot.sendMessage(msg.chat.id, '✅ Ответ переслан пользователю.');
});

bot.on('polling_error', (error) => {
  console.error('Polling error:', error.message);
});

console.log('Telegram support bot started.');
