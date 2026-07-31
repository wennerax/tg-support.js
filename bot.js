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
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      bans: parsed.bans || {},
      questions: parsed.questions || {},
    };
  } catch (error) {
    return { ...DEFAULT_STATE };
  }
}

function saveState() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
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
  const match = String(value).match(/^([0-9]+)([smhd])$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const map = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
  return amount * map[unit];
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

bot.onText(/^\/(start)\b/i, async (msg) => {
  if (msg.chat.type === 'private') {
    await bot.sendMessage(
      msg.chat.id,
      'Это помощник беседы БРЕДИМ.\nПишите вопросы, а наша модерация постарается ответить в кратчайшие сроки.'
    );
  }
});

bot.onText(/^(?:!|\/)(бан|разбан|баны|help|ban|unban|bans|help)\b/i, async (msg, match) => {
  if (msg.chat.id !== MODERATOR_GROUP_ID) {
    return;
  }

  const command = String(match[1] || '').toLowerCase();
  const text = msg.text || '';
  const isRussianCommand = ['бан', 'разбан', 'баны'].includes(command);

  if (command === 'help' || command === 'помощь') {
    await bot.sendMessage(
      msg.chat.id,
      'Команды для модераторов:\n!бан <@username> время причина\n!разбан <@username>\n!баны\n!help\n\nEnglish aliases:\n/ban <@username> time reason\n/unban <@username>\n/bans\n/help'
    );
    return;
  }

  if (command === 'баны' || command === 'bans') {
    await bot.sendMessage(msg.chat.id, formatBanList());
    return;
  }

  if (command === 'разбан' || command === 'unban') {
    const username = extractMentionUsername(text);
    if (!username) {
      await bot.sendMessage(msg.chat.id, 'Формат: !разбан @username или /unban @username');
      return;
    }

    const user = { username };
    unbanUser(user);
    await bot.sendMessage(msg.chat.id, `Пользователь @${username} разбанен.`);
    return;
  }

  if (command === 'бан' || command === 'ban') {
    const args = text.split(/\s+/).slice(1);
    const username = extractMentionUsername(text);
    const duration = args.find((item) => parseDurationToMs(item));
    const reasonParts = duration ? args.slice(args.indexOf(duration) + 1) : [];
    const reason = reasonParts.join(' ') || 'без причины';

    if (!username || !duration) {
      await bot.sendMessage(
        msg.chat.id,
        'Формат: !бан <@username> 1h причина или /ban <@username> 1h reason'
      );
      return;
    }

    const ms = parseDurationToMs(duration);
    if (!ms) {
      await bot.sendMessage(msg.chat.id, 'Некорректное время. Примеры: 10m, 1h, 1d.');
      return;
    }

    banUser({
      user: { username },
      reason,
      until: Date.now() + ms,
    });

    await bot.sendMessage(
      msg.chat.id,
      `Пользователь @${username} заблокирован на ${duration}. Причина: ${reason}`
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

    await bot.sendMessage(
      MODERATOR_GROUP_ID,
      `Модератор ${await summarizeUser(callbackQuery.from)} взял вопрос в работу.`
    );
    return;
  }

  if (data.startsWith('ban:')) {
    const user = { id: question.userId, username: question.userUsername };
    banUser({ user, reason: 'модератором через кнопку ban', until: null });
    await bot.answerCallbackQuery(callbackQuery.id, {
      text: `Пользователь ${await summarizeUser(user)} забанен.`,
    });
    await bot.sendMessage(
      MODERATOR_GROUP_ID,
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
      await bot.sendMessage(msg.chat.id, 'Вы забанены и не можете отправлять вопросы боту.');
      return;
    }

    const forwarded = await bot.forwardMessage(MODERATOR_GROUP_ID, msg.chat.id, msg.message_id);
    const questionText = `Новый вопрос от ${await summarizeUser(msg.from)}\n${escapeHtml(msg.text || '')}`;
    const keyboardMessage = await bot.sendMessage(
      MODERATOR_GROUP_ID,
      questionText,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Ответить', callback_data: `answer:${forwarded.message_id}` }],
            [{ text: 'Забанить', callback_data: `ban:${forwarded.message_id}` }],
          ],
        },
      }
    );

    state.questions[String(keyboardMessage.message_id)] = {
      userId: msg.from.id,
      userUsername: msg.from.username || null,
      originalMessageId: msg.message_id,
      forwardedMessageId: forwarded.message_id,
      moderatorMessageId: keyboardMessage.message_id,
      claimedBy: null,
      answered: false,
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
    return entry && entry.forwardedMessageId === replyTo.message_id;
  });

  if (!question) {
    return;
  }

  if (question.answered) {
    await bot.sendMessage(msg.chat.id, 'Этот вопрос уже был обработан.');
    return;
  }

  if (question.claimedBy && question.claimedBy !== msg.from.id) {
    await bot.sendMessage(msg.chat.id, 'Этот вопрос уже взят в работу другим модератором.');
    return;
  }

  await bot.forwardMessage(question.userId, msg.chat.id, msg.message_id);
  await bot.editMessageReplyMarkup(
    { inline_keyboard: [] },
    {
      chat_id: MODERATOR_GROUP_ID,
      message_id: question.moderatorMessageId,
    }
  );
  question.answered = true;
  saveState();
  await bot.sendMessage(msg.chat.id, 'Ответ переслан пользователю.');
});

bot.on('polling_error', (error) => {
  console.error('Polling error:', error.message);
});

console.log('Telegram support bot started.');
