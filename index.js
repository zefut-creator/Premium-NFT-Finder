'use strict';

const TelegramBot = require('node-telegram-bot-api');
const fs = require('node:fs');
const path = require('node:path');

const token = (process.env.BOT_TOKEN || '').trim();
const adminId = (process.env.ADMIN_ID || '').trim();
if (!token) { console.error('[CONFIG] BOT_TOKEN is missing.'); process.exit(1); }
if (!adminId) { console.error('[CONFIG] ADMIN_ID is missing. Set your numeric Telegram user ID.'); process.exit(1); }

const dataFile = path.resolve(process.env.DB_PATH || './data/scanner.json');
fs.mkdirSync(path.dirname(dataFile), { recursive: true });

function loadData() {
  try {
    if (!fs.existsSync(dataFile)) return { sources: {}, matches: [] };
    const value = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    return {
      sources: value.sources && typeof value.sources === 'object' ? value.sources : {},
      matches: Array.isArray(value.matches) ? value.matches : []
    };
  } catch (error) {
    console.error('[STORAGE] Cannot read data:', error.message);
    process.exit(1);
  }
}
const data = loadData();
function save() {
  const tmp = dataFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, dataFile);
}
const isOwner = id => String(id) === adminId;
const selfClaims = [
  /\bу меня\b.{0,55}\b(premium|премиум|прем)\b/i,
  /\b(premium|премиум|прем)\b.{0,55}\b(есть|активен|купил|оформил|подключил)\b/i,
  /\bесть\b.{0,35}\b(nft|нфт|подар(ок|ки|ка))\b/i,
  /\bмои\b.{0,35}\b(nft|нфт|подарки)\b/i,
  /\bу меня\b.{0,55}\b(nft|нфт|подар(ок|ки|ка))\b/i,
  /\b(владею|купил|получил)\b.{0,55}\b(nft|нфт|подар(ок|ки|ка))\b/i
];
const isSelfClaim = value => selfClaims.some(pattern => pattern.test(value));
const clean = (value, max = 220) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
const sourceKey = chatId => String(chatId);

const bot = new TelegramBot(token, { polling: false });
let stopping = false;
bot.on('polling_error', error => console.error('[POLLING]', error.message));
bot.on('error', error => console.error('[BOT]', error.message));

async function showHelp(chatId) {
  await bot.sendMessage(chatId,
    '🔎 Premium / NFT message finder\n\n' +
    'Бот сохраняет только сообщения, где автор сам явно пишет о наличии у него Premium или NFT-подарков. ' +
    'Он не выгружает список участников, не проверяет скрытые данные и не пишет людям автоматически.\n\n' +
    'Команды:\n/sources — подключённые группы\n/results — найденные подходящие сообщения\n/clear — очистить результаты\n\n' +
    'Чтобы подключить группу: добавь бота в группу и отправь там /watch. ' +
    'Включить сбор сообщений может только администратор группы. Для чтения обычных сообщений отключи Privacy Mode через @BotFather (/setprivacy → Disable).'
  );
}
bot.onText(/^\/start(?:@\w+)?$/, async msg => {
  if (!msg.from || !isOwner(msg.from.id)) return bot.sendMessage(msg.chat.id, 'Этот сканер настроен для своего владельца.').catch(() => {});
  await showHelp(msg.chat.id);
});
bot.onText(/^\/help(?:@\w+)?$/, async msg => {
  if (msg.from && isOwner(msg.from.id)) await showHelp(msg.chat.id);
});

bot.onText(/^\/watch(?:@\w+)?$/, async msg => {
  if (!msg.from || !msg.chat || !['group', 'supergroup'].includes(msg.chat.type)) return;
  try {
    const member = await bot.getChatMember(msg.chat.id, msg.from.id);
    if (!['creator', 'administrator'].includes(member.status)) {
      return bot.sendMessage(msg.chat.id, 'Подключить мониторинг может только администратор этой группы.');
    }
    data.sources[sourceKey(msg.chat.id)] = {
      id: String(msg.chat.id), title: clean(msg.chat.title || 'Группа', 100),
      username: msg.chat.username || null, addedAt: new Date().toISOString()
    };
    save();
    await bot.sendMessage(msg.chat.id, 'Группа подключена. Сохраняются только сообщения с явным самостоятельным упоминанием автором своего Premium или NFT. Автоматических личных сообщений не будет.');
  } catch (error) {
    console.error('[WATCH]', error.message);
    await bot.sendMessage(msg.chat.id, 'Не удалось подключить группу: ' + clean(error.message, 160));
  }
});
bot.onText(/^\/unwatch(?:@\w+)?$/, async msg => {
  if (!msg.from || !msg.chat || !['group', 'supergroup'].includes(msg.chat.type)) return;
  try {
    const member = await bot.getChatMember(msg.chat.id, msg.from.id);
    if (!['creator', 'administrator'].includes(member.status)) return bot.sendMessage(msg.chat.id, 'Отключить мониторинг может только администратор этой группы.');
    delete data.sources[sourceKey(msg.chat.id)];
    save();
    await bot.sendMessage(msg.chat.id, 'Мониторинг этой группы отключён.');
  } catch (error) { console.error('[UNWATCH]', error.message); }
});
bot.onText(/^\/sources(?:@\w+)?$/, async msg => {
  if (!msg.from || !isOwner(msg.from.id)) return;
  const items = Object.values(data.sources);
  const output = items.length
    ? '📚 Подключённые группы:\n' + items.map((s, i) => (i + 1) + '. ' + s.title + (s.username ? ' (@' + s.username + ')' : '')).join('\n')
    : 'Пока нет подключённых групп. Администратор группы должен добавить бота и отправить /watch.';
  await bot.sendMessage(msg.chat.id, output);
});
bot.onText(/^\/results(?:@\w+)?$/, async msg => {
  if (!msg.from || !isOwner(msg.from.id)) return;
  const rows = data.matches.slice(-20).reverse();
  if (!rows.length) return bot.sendMessage(msg.chat.id, 'Пока совпадений нет.');
  for (const row of rows) {
    const who = row.username ? '@' + row.username : clean(row.displayName || 'Пользователь');
    const link = row.messageLink ? '\n' + row.messageLink : '';
    await bot.sendMessage(msg.chat.id, '🔎 Возможное совпадение\nГруппа: ' + row.chatTitle + '\nАвтор: ' + who + '\nСообщение: ' + row.text + link + '\nВремя: ' + row.date);
  }
});
bot.onText(/^\/clear(?:@\w+)?$/, async msg => {
  if (!msg.from || !isOwner(msg.from.id)) return;
  data.matches = [];
  save();
  await bot.sendMessage(msg.chat.id, 'Сохранённые совпадения очищены.');
});

bot.on('message', async msg => {
  if (!msg.chat || !['group', 'supergroup'].includes(msg.chat.type)) return;
  if (!data.sources[sourceKey(msg.chat.id)]) return;
  if (!msg.from || msg.from.is_bot || !msg.text || msg.text.startsWith('/')) return;
  if (!isSelfClaim(msg.text)) return;
  const username = msg.from.username || null;
  const messageLink = msg.chat.username && msg.message_id ? 'https://t.me/' + msg.chat.username + '/' + msg.message_id : null;
  const fingerprint = String(msg.chat.id) + ':' + String(msg.message_id);
  if (data.matches.some(row => row.fingerprint === fingerprint)) return;
  data.matches.push({
    fingerprint, chatTitle: clean(msg.chat.title || 'Группа', 100), username,
    displayName: clean([msg.from.first_name, msg.from.last_name].filter(Boolean).join(' '), 80),
    text: clean(msg.text, 220), messageLink,
    date: new Date((msg.date || Math.floor(Date.now() / 1000)) * 1000).toISOString()
  });
  if (data.matches.length > 500) data.matches = data.matches.slice(-500);
  try {
    save();
    await bot.sendMessage(adminId,
      '🔎 Найдено публичное самоупоминание\nГруппа: ' + clean(msg.chat.title, 100) +
      '\nАвтор: ' + (username ? '@' + username : clean(msg.from.first_name || 'без username')) +
      '\nТекст: ' + clean(msg.text, 220) +
      '\n' + (messageLink || 'Ссылка на сообщение недоступна в этой группе.'));
  } catch (error) { console.error('[MATCH SAVE/NOTICE]', error.message); }
});

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log('[SHUTDOWN]', signal);
  try { await bot.stopPolling(); } catch (error) { console.error(error.message); }
  try { save(); } catch (error) { console.error(error.message); }
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', error => console.error('[UNHANDLED]', error));

async function start() {
  try {
    const me = await bot.getMe();
    console.log('[STARTUP] Authenticated as @' + me.username);
    await bot.deleteWebHook({ drop_pending_updates: false });
    await bot.startPolling({ restart: true, params: { timeout: 10 } });
    console.log('[STARTUP] Polling started.');
  } catch (error) {
    console.error('[STARTUP FAILED]', error.message);
    process.exit(1);
  }
}
start();
