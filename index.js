const TelegramBot = require('node-telegram-bot-api');
const Database = require('better-sqlite3');

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('BOT_TOKEN is missing. Add it to your hosting environment variables.');
  process.exit(1);
}

const adminId = process.env.ADMIN_ID ? Number(process.env.ADMIN_ID) : null;
const db = new Database(process.env.DB_PATH || 'data.sqlite');
db.pragma('journal_mode = WAL');
db.exec(\`
  CREATE TABLE IF NOT EXISTS users (
    telegram_id INTEGER PRIMARY KEY,
    username TEXT,
    display_name TEXT NOT NULL,
    premium TEXT NOT NULL DEFAULT 'unknown',
    has_nft TEXT NOT NULL DEFAULT 'unknown',
    collections TEXT NOT NULL DEFAULT '',
    referred_by INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
\`);

const bot = new TelegramBot(token, { polling: true });
const states = new Map();

const upsertUser = db.prepare(\`
  INSERT INTO users (telegram_id, username, display_name, referred_by)
  VALUES (@id, @username, @name, @referrer)
  ON CONFLICT(telegram_id) DO UPDATE SET
    username = excluded.username,
    display_name = excluded.display_name,
    updated_at = CURRENT_TIMESTAMP
\`);
const getUser = db.prepare('SELECT * FROM users WHERE telegram_id = ?');
const setField = db.prepare('UPDATE users SET premium = ?, updated_at = CURRENT_TIMESTAMP WHERE telegram_id = ?');
const setNft = db.prepare('UPDATE users SET has_nft = ?, updated_at = CURRENT_TIMESTAMP WHERE telegram_id = ?');
const setCollections = db.prepare('UPDATE users SET collections = ?, updated_at = CURRENT_TIMESTAMP WHERE telegram_id = ?');

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
      [{ text: '⭐ Premium есть', callback_data: 'premium_yes' }, { text: 'Premium нет', callback_data: 'premium_no' }],
      [{ text: '🎁 Есть NFT-подарки', callback_data: 'nft_yes' }, { text: 'NFT нет', callback_data: 'nft_no' }],
      [{ text: 'Готово', callback_data: 'home' }]
    ]
  };
}

function userLabel(row) {
  if (row.username) return '@' + row.username;
  return row.display_name || 'Участник без username';
}

async function showHome(chatId, name) {
  await bot.sendMessage(chatId,
    'Привет, ' + (name || 'друг') + '!\\n\\nЭто добровольный каталог участников, которые сами указали наличие Telegram Premium или NFT-подарков. Бот не сканирует Telegram и не проверяет скрытые данные.\\n\\nВыбери действие:',
    { reply_markup: mainKeyboard() });
}

bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
  const id = msg.from.id;
  const rawRef = match && match[1] ? match[1].trim() : '';
  const referrer = /^ref_(\d+)$/.test(rawRef) ? Number(rawRef.slice(4)) : null;
  const safeReferrer = referrer && referrer !== id && getUser.get(referrer) ? referrer : null;

  upsertUser.run({
    id,
    username: msg.from.username || null,
    name: [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ') || 'Участник',
    referrer: getUser.get(id) ? getUser.get(id).referred_by : safeReferrer
  });
  await showHome(msg.chat.id, msg.from.first_name);
});

bot.onText(/\/help/, msg => showHome(msg.chat.id, msg.from.first_name));

bot.on('callback_query', async query => {
  const id = query.from.id;
  const chatId = query.message.chat.id;
  const data = query.data;
  await bot.answerCallbackQuery(query.id).catch(() => {});

  if (!getUser.get(id)) {
    await bot.sendMessage(chatId, 'Сначала нажми /start.');
    return;
  }

  if (data === 'home') return showHome(chatId, query.from.first_name);

  if (data === 'profile') {
    return bot.sendMessage(chatId,
      'Укажи информацию о себе. Она будет видна только в каталоге участников, которые сами зарегистрировались.',
      { reply_markup: profileKeyboard() });
  }

  if (data === 'premium_yes' || data === 'premium_no') {
    setField.run(data === 'premium_yes' ? 'yes' : 'no', id);
    return bot.sendMessage(chatId, 'Статус Premium сохранён.', { reply_markup: profileKeyboard() });
  }

  if (data === 'nft_yes' || data === 'nft_no') {
    setNft.run(data === 'nft_yes' ? 'yes' : 'no', id);
    if (data === 'nft_yes') {
      states.set(id, 'collections');
      return bot.sendMessage(chatId, 'Напиши названия своих NFT-коллекций или отправь «Пропустить». Не отправляй секретные данные или коды.');
    }
    setCollections.run('', id);
    return bot.sendMessage(chatId, 'Информация о NFT сохранена.', { reply_markup: profileKeyboard() });
  }

  if (data === 'my_profile') {
    const u = getUser.get(id);
    const premium = u.premium === 'yes' ? 'Есть' : u.premium === 'no' ? 'Нет' : 'Не указано';
    const nft = u.has_nft === 'yes' ? 'Есть' : u.has_nft === 'no' ? 'Нет' : 'Не указано';
    return bot.sendMessage(chatId,
      '👤 Твой профиль\\nUsername: ' + (u.username ? '@' + u.username : 'не указан') +
      '\\nPremium: ' + premium + '\\nNFT-подарки: ' + nft +
      '\\nКоллекции: ' + (u.collections || 'не указаны'),
      { reply_markup: mainKeyboard() });
  }

  if (data === 'referrals') {
    const link = 'https://t.me/' + (await bot.getMe()).username + '?start=ref_' + id;
    const count = db.prepare('SELECT COUNT(*) AS n FROM users WHERE referred_by = ?').get(id).n;
    return bot.sendMessage(chatId,
      '🔗 Твоя ссылка:\\n' + link + '\\n\\nПриглашено: ' + count +
      '\\n\\nРеферал засчитывается после первого запуска бота новым пользователем. Сейчас система ведёт статистику приглашений, денежные выплаты не обещаются.',
      { reply_markup: mainKeyboard() });
  }

  if (data === 'search_premium' || data === 'search_nft') {
    const field = data === 'search_premium' ? 'premium' : 'has_nft';
    const rows = db.prepare(
      'SELECT username, display_name, collections FROM users WHERE ' + field + " = 'yes' ORDER BY updated_at DESC LIMIT 20"
    ).all();
    const title = field === 'premium' ? '⭐ Участники с Premium' : '🎁 Владельцы NFT-подарков';
    if (!rows.length) return bot.sendMessage(chatId, title + '\\nПока никто не указал эту информацию.');
    const lines = rows.map((u, i) => {
      const collection = field === 'has_nft' && u.collections ? ' — ' + u.collections : '';
      return (i + 1) + '. ' + userLabel(u) + collection;
    });
    return bot.sendMessage(chatId, title + '\\n\\n' + lines.join('\\n') + '\\n\\nПоказаны только участники, которые добровольно заполнили профиль.');
  }

  if (data === 'delete_me') {
    db.prepare('DELETE FROM users WHERE telegram_id = ?').run(id);
    states.delete(id);
    return bot.sendMessage(chatId, 'Твой профиль и реферальная запись удалены из базы. Чтобы пользоваться ботом снова, отправь /start.');
  }
});

bot.on('message', async msg => {
  if (!msg.text || msg.text.startsWith('/')) return;
  const state = states.get(msg.from.id);
  if (state !== 'collections') return;
  const value = msg.text.trim();
  if (value.length > 300) {
    return bot.sendMessage(msg.chat.id, 'Слишком длинный текст. Укажи названия коллекций кратко (до 300 символов).');
  }
  setCollections.run(/^пропустить$/i.test(value) ? '' : value, msg.from.id);
  states.delete(msg.from.id);
  await bot.sendMessage(msg.chat.id, 'Коллекции сохранены.', { reply_markup: mainKeyboard() });
});

bot.onText(/\/stats/, async msg => {
  if (!adminId || msg.from.id !== adminId) return;
  const total = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const premium = db.prepare("SELECT COUNT(*) AS n FROM users WHERE premium = 'yes'").get().n;
  const nft = db.prepare("SELECT COUNT(*) AS n FROM users WHERE has_nft = 'yes'").get().n;
  const refs = db.prepare('SELECT COUNT(*) AS n FROM users WHERE referred_by IS NOT NULL').get().n;
  bot.sendMessage(msg.chat.id, '📊 Статистика\\nПользователей: ' + total + '\\nPremium: ' + premium + '\\nNFT: ' + nft + '\\nПришли по реферальной ссылке: ' + refs);
});

bot.on('polling_error', err => console.error('Telegram polling error:', err.message));
console.log('Bot is running.');
