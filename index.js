'use strict';

const TelegramBot = require('node-telegram-bot-api');
const fs = require('node:fs');
const path = require('node:path');

const token = (process.env.BOT_TOKEN || '').trim();
if (!token) {
  console.error('[CONFIG] BOT_TOKEN is missing. Add BOT_TOKEN in the hosting environment.');
  process.exit(1);
}

const adminId = (process.env.ADMIN_ID || '').trim();
const dataFile = path.resolve(process.env.DB_PATH || './data/users.json');
const dataDir = path.dirname(dataFile);

try {
  fs.mkdirSync(dataDir, { recursive: true });
} catch (error) {
  console.error('[STORAGE] Cannot create data directory:', error.message);
  process.exit(1);
}

function loadData() {
  try {
    if (!fs.existsSync(dataFile)) return { users: {} };
    const parsed = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || !parsed.users || typeof parsed.users !== 'object') {
      throw new Error('Invalid data file format');
    }
    return parsed;
  } catch (error) {
    console.error('[STORAGE] Cannot read data file:', error.message);
    process.exit(1);
  }
}

let data = loadData();

function saveData() {
  const temporaryFile = dataFile + '.tmp';
  fs.writeFileSync(temporaryFile, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(temporaryFile, dataFile);
}

function getUser(id) {
  return data.users[String(id)] || null;
}

function upsertUser(from, referrerId) {
  const id = String(from.id);
  const existing = getUser(id);
  const displayName = [from.first_name, from.last_name].filter(Boolean).join(' ') || 'Участник';

  if (existing) {
    existing.username = from.username || null;
    existing.display_name = displayName;
    existing.updated_at = new Date().toISOString();
  } else {
    data.users[id] = {
      telegram_id: id,
      username: from.username || null,
      display_name: displayName,
      premium: 'unknown',
      has_nft: 'unknown',
      collections: '',
      referred_by: referrerId && referrerId !== id && getUser(referrerId) ? referrerId : null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
  }
  saveData();
  return data.users[id];
}

function mainKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '📝 Заполнить профиль', callback_data: 'profile' }],
      [{ text: '⭐ Участники с Premium', callback_data: 'search_premium' }],
      [{ text: '🎁 Владельцы NFT-подарков', callback_data: 'search_nft' }],
      [{ text: '🔗 Моя реферальная ссылка', callback_data: 'referrals' }],
      [{ text: '👤 Мой профиль', callback_data: 'my_profile' }],
      [{ text: '🗑 Удалить мои данные', callback_data: 'delete_me' }]
    ]
  };
}

function profileKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '⭐ Premium есть', callback_data: 'premium_yes' },
        { text: 'Premium нет', callback_data: 'premium_no' }
      ],
      [
        { text: '🎁 Есть NFT-подарки', callback_data: 'nft_yes' },
        { text: 'NFT нет', callback_data: 'nft_no' }
      ],
      [{ text: '↩️ В меню', callback_data: 'home' }]
    ]
  };
}

function userLabel(user) {
  return user.username ? '@' + user.username : (user.display_name || 'Участник без username');
}

function status(value) {
  if (value === 'yes') return 'Есть';
  if (value === 'no') return 'Нет';
  return 'Не указано';
}

const bot = new TelegramBot(token, { polling: false });
const states = new Map();
let stopping = false;

bot.on('polling_error', error => {
  console.error('[TELEGRAM POLLING]', error && error.message ? error.message : error);
});
bot.on('error', error => {
  console.error('[TELEGRAM]', error && error.message ? error.message : error);
});

async function showHome(chatId, name) {
  return bot.sendMessage(
    chatId,
    'Привет, ' + (name || 'друг') + '!\\n\\n' +
      'Это добровольный каталог участников, которые сами указали наличие Telegram Premium или NFT-подарков. ' +
      'Бот не сканирует Telegram и не проверяет скрытые данные.\\n\\nВыбери действие:',
    { reply_markup: mainKeyboard() }
  );
}

bot.onText(/\\/start(?:@\\w+)?(?:\\s+(.+))?/, async (msg, match) => {
  try {
    const rawRef = match && match[1] ? match[1].trim() : '';
    const refMatch = rawRef.match(/^ref_(\\d+)$/);
    const referrerId = refMatch ? refMatch[1] : null;
    upsertUser(msg.from, referrerId);
    await showHome(msg.chat.id, msg.from.first_name);
  } catch (error) {
    console.error('[START HANDLER]', error);
    await bot.sendMessage(msg.chat.id, 'Не удалось открыть меню. Попробуй ещё раз через минуту.').catch(() => {});
  }
});

bot.onText(/\\/help(?:@\\w+)?/, async msg => {
  try {
    await showHome(msg.chat.id, msg.from.first_name);
  } catch (error) {
    console.error('[HELP HANDLER]', error);
  }
});

bot.onText(/\\/stats(?:@\\w+)?/, async msg => {
  if (!adminId || String(msg.from.id) !== adminId) return;
  try {
    const users = Object.values(data.users);
    const premium = users.filter(user => user.premium === 'yes').length;
    const nft = users.filter(user => user.has_nft === 'yes').length;
    const referrals = users.filter(user => user.referred_by).length;
    await bot.sendMessage(msg.chat.id,
      '📊 Статистика\\nПользователей: ' + users.length +
      '\\nPremium: ' + premium + '\\nNFT: ' + nft + '\\nПришли по реферальной ссылке: ' + referrals);
  } catch (error) {
    console.error('[STATS HANDLER]', error);
  }
});

bot.on('callback_query', async query => {
  const userId = String(query.from.id);
  const chatId = query.message && query.message.chat ? query.message.chat.id : null;
  const action = query.data || '';

  try {
    await bot.answerCallbackQuery(query.id);
    if (!chatId) return;
    if (!getUser(userId)) {
      await bot.sendMessage(chatId, 'Сначала отправь /start.');
      return;
    }

    if (action === 'home') return showHome(chatId, query.from.first_name);

    if (action === 'profile') {
      return bot.sendMessage(chatId,
        'Укажи информацию о себе. В каталоге отображаются только данные, которые участники сами решили указать.',
        { reply_markup: profileKeyboard() });
    }

    if (action === 'premium_yes' || action === 'premium_no') {
      getUser(userId).premium = action === 'premium_yes' ? 'yes' : 'no';
      getUser(userId).updated_at = new Date().toISOString();
      saveData();
      return bot.sendMessage(chatId, 'Статус Premium сохранён.', { reply_markup: profileKeyboard() });
    }

    if (action === 'nft_yes' || action === 'nft_no') {
      const user = getUser(userId);
      user.has_nft = action === 'nft_yes' ? 'yes' : 'no';
      user.updated_at = new Date().toISOString();
      if (action === 'nft_yes') {
        states.set(userId, 'collections');
        saveData();
        return bot.sendMessage(chatId,
          'Напиши названия своих NFT-коллекций или отправь «Пропустить». Не отправляй пароли, коды или секретные данные.');
      }
      user.collections = '';
      saveData();
      return bot.sendMessage(chatId, 'Информация о NFT сохранена.', { reply_markup: profileKeyboard() });
    }

    if (action === 'my_profile') {
      const user = getUser(userId);
      return bot.sendMessage(chatId,
        '👤 Твой профиль\\nUsername: ' + (user.username ? '@' + user.username : 'не указан') +
        '\\nPremium: ' + status(user.premium) +
        '\\nNFT-подарки: ' + status(user.has_nft) +
        '\\nКоллекции: ' + (user.collections || 'не указаны'),
        { reply_markup: mainKeyboard() });
    }

    if (action === 'referrals') {
      const me = await bot.getMe();
      const link = 'https://t.me/' + me.username + '?start=ref_' + userId;
      const count = Object.values(data.users).filter(user => user.referred_by === userId).length;
      return bot.sendMessage(chatId,
        '🔗 Твоя ссылка:\\n' + link + '\\n\\nПриглашено: ' + count +
        '\\n\\nПриглашение засчитывается, когда новый пользователь впервые запускает бота по этой ссылке.',
        { reply_markup: mainKeyboard() });
    }

    if (action === 'search_premium' || action === 'search_nft') {
      const field = action === 'search_premium' ? 'premium' : 'has_nft';
      const rows = Object.values(data.users)
        .filter(user => user[field] === 'yes')
        .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
        .slice(0, 20);
      const title = field === 'premium' ? '⭐ Участники с Premium' : '🎁 Владельцы NFT-подарков';
      if (!rows.length) {
        return bot.sendMessage(chatId, title + '\\nПока никто не указал эту информацию.', { reply_markup: mainKeyboard() });
      }
      const lines = rows.map((user, index) => {
        const collection = field === 'has_nft' && user.collections ? ' — ' + user.collections : '';
        return (index + 1) + '. ' + userLabel(user) + collection;
      });
      return bot.sendMessage(chatId,
        title + '\\n\\n' + lines.join('\\n') +
        '\\n\\nПоказаны только участники, которые добровольно зарегистрировались.',
        { reply_markup: mainKeyboard() });
    }

    if (action === 'delete_me') {
      delete data.users[userId];
      states.delete(userId);
      saveData();
      return bot.sendMessage(chatId,
        'Твой профиль удалён из каталога. Чтобы пользоваться ботом снова, отправь /start.');
    }
  } catch (error) {
    console.error('[CALLBACK HANDLER]', error);
    if (chatId) {
      await bot.sendMessage(chatId, 'Не удалось выполнить действие. Попробуй ещё раз.').catch(() => {});
    }
  }
});

bot.on('message', async msg => {
  if (!msg.text || msg.text.startsWith('/')) return;
  const userId = String(msg.from.id);
  if (states.get(userId) !== 'collections') return;

  const value = msg.text.trim();
  if (value.length > 300) {
    await bot.sendMessage(msg.chat.id, 'Слишком длинный текст. Укажи названия коллекций кратко — до 300 символов.');
    return;
  }

  const user = getUser(userId);
  if (!user) {
    states.delete(userId);
    return;
  }

  user.collections = /^пропустить$/i.test(value) ? '' : value;
  user.updated_at = new Date().toISOString();
  states.delete(userId);
  try {
    saveData();
    await bot.sendMessage(msg.chat.id, 'Коллекции сохранены.', { reply_markup: mainKeyboard() });
  } catch (error) {
    console.error('[COLLECTIONS HANDLER]', error);
    await bot.sendMessage(msg.chat.id, 'Не удалось сохранить данные. Попробуй ещё раз.').catch(() => {});
  }
});

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log('[SHUTDOWN] Received ' + signal + ', stopping bot...');
  try {
    await bot.stopPolling();
  } catch (error) {
    console.error('[SHUTDOWN]', error.message);
  }
  try {
    saveData();
  } catch (error) {
    console.error('[STORAGE] Save during shutdown failed:', error.message);
  }
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', error => {
  console.error('[UNHANDLED REJECTION]', error);
});

async function start() {
  try {
    const me = await bot.getMe();
    console.log('[STARTUP] Authenticated as @' + me.username + ' (ID ' + me.id + ')');

    // Long polling and an active webhook cannot be used at the same time.
    await bot.deleteWebHook({ drop_pending_updates: false });
    await bot.startPolling({ restart: true, params: { timeout: 10 } });

    console.log('[STARTUP] Polling started. Send /start to @' + me.username);
  } catch (error) {
    console.error('[STARTUP FAILED]', error && error.message ? error.message : error);
    process.exit(1);
  }
}

start();
