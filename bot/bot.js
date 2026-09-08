/* ============================================================
   RIZZOMA — референс-бэкенд Mini App.
   Делает ровно три вещи:
     1) /start — открывает мини-приложение и связывает аккаунт с узлом;
     2) /api/visit — записывает, кто по чьей ссылке пришёл;
     3) /api/friends — отдаёт секцию «Свои»: ветвь, пригласивший, соседи.

   ⚠ Хранилище здесь — Map в памяти: перезапуск стирает всё.
     Для боевой версии замени store на Postgres/Redis и добавь
     платёжного провайдера (Telegram Payments / Stars) для покупок.
   ⚠ Telegram НЕ отдаёт адресную книгу пользователя ни боту, ни Mini App.
     Никакого «списка контактов» здесь нет и быть не может — граф
     строится только из переходов по реферальным ссылкам.
   ============================================================ */
import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import { Bot, InlineKeyboard } from 'grammy';

const TOKEN      = process.env.BOT_TOKEN;
const APP_URL    = process.env.APP_URL;                       // https://…/index.html
const PORT       = Number(process.env.PORT || 8080);
const ORIGIN     = process.env.CORS_ORIGIN || '*';
const MAX_AGE    = 24 * 60 * 60;                              // initData живёт сутки

if(!TOKEN || !APP_URL){
  console.error('Нужны BOT_TOKEN и APP_URL в .env — см. .env.example');
  process.exit(1);
}

/* ---------- хранилище ---------- */
const users = new Map();   // tgId -> {id,name,username,photo,code,invitedBy,paid,ts}
const codes = new Map();   // code -> tgId

const upsert = (tg, patch = {}) => {
  const id = String(tg.id);
  const cur = users.get(id) || {id, code:null, invitedBy:null, paid:false, ts:Date.now()};
  const next = Object.assign(cur, {
    name: [tg.first_name, tg.last_name].filter(Boolean).join(' ') || cur.name || 'Узел',
    username: tg.username || cur.username || '',
    photo: tg.photo_url || cur.photo || ''
  }, patch);
  users.set(id, next);
  if(next.code) codes.set(next.code, id);
  return next;
};

/* ---------- валидация initData (HMAC «WebAppData») ---------- */
function validateInitData(initData){
  if(typeof initData !== 'string' || !initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if(!hash) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');

  const secret = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  const calc = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');

  const a = Buffer.from(calc, 'hex'), b = Buffer.from(hash, 'hex');
  if(a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const authDate = Number(params.get('auth_date') || 0);
  if(!authDate || Date.now()/1000 - authDate > MAX_AGE) return null;

  try { return JSON.parse(params.get('user') || 'null'); } catch { return null; }
}

/* ============================ БОТ ============================ */
const bot = new Bot(TOKEN);

const openKeyboard = () => new InlineKeyboard().webApp('Открыть RIZZOMA', APP_URL);

bot.command('start', async ctx => {
  const payload = (ctx.match || '').trim();
  const tg = ctx.from;

  if(payload.startsWith('link_')){
    // привязка аккаунта к уже активированному узлу (кнопка «Привязать через бота»)
    const code = payload.slice(5).toUpperCase().slice(0, 8);
    upsert(tg, { code });
    await ctx.reply(
      `Узел ${code} привязан к твоему аккаунту.\n` +
      `Теперь в разделе «Свои» видно твою ветвь и тех, кто рядом.`,
      { reply_markup: openKeyboard() }
    );
    return;
  }

  if(/^[A-Z0-9]{4,8}$/i.test(payload)){
    // переход по ссылке t.me/<бот>?startapp=КОД — фиксируем атрибуцию
    const me = upsert(tg);
    const ref = payload.toUpperCase();
    if(!me.invitedBy && me.code !== ref) upsert(tg, { invitedBy: ref });
  } else {
    upsert(tg);
  }

  await ctx.reply(
    'RIZZOMA — корневая сеть.\nVIDEO LOUNGE · 12.09.2026 · СПб · 18+',
    { reply_markup: openKeyboard() }
  );
});

bot.catch(err => console.error('bot error:', err));

/* ============================ API ============================ */
const app = express();
app.use(express.json({ limit: '64kb' }));
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', ORIGIN);
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if(req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const auth = (req, res) => {
  const tg = validateInitData(req.body && req.body.initData);
  if(!tg){ res.status(401).json({ error: 'bad initData' }); return null; }
  return tg;
};

/* Mini App сообщает, по чьей ссылке открылась (startapp не долетает до бота). */
app.post('/api/visit', (req, res) => {
  const tg = auth(req, res); if(!tg) return;
  const me = upsert(tg);
  const ref = String(req.body.ref || '').toUpperCase().slice(0, 8);
  if(/^[A-Z0-9]{4,8}$/.test(ref) && !me.invitedBy && me.code !== ref) upsert(tg, { invitedBy: ref });
  res.json({ ok: true });
});

/* Отметка об оплате. В проде вызывается не клиентом, а вебхуком
   платёжного провайдера / successful_payment от Telegram. */
app.post('/api/purchase', (req, res) => {
  const tg = auth(req, res); if(!tg) return;
  const code = String(req.body.code || '').toUpperCase().slice(0, 8) || null;
  upsert(tg, { paid: true, ...(code ? { code } : {}) });
  res.json({ ok: true });
});

/* Секция «Свои»: ветвь + пригласивший + соседи по ветви. */
app.post('/api/friends', (req, res) => {
  const tg = auth(req, res); if(!tg) return;
  const me = upsert(tg);
  const all = [...users.values()];
  const out = new Map();

  const push = (u, status) => {
    if(!u || u.id === me.id || out.has(u.id)) return;
    out.set(u.id, {
      id: u.id, name: u.name, username: u.username, photo: u.photo,
      status, tier: 0
    });
  };

  if(me.code) all.filter(u => u.invitedBy === me.code).forEach(u => push(u, u.paid ? 'paid' : 'node'));
  if(me.invitedBy){
    push(users.get(codes.get(me.invitedBy)), 'paid');                       // кто позвал
    all.filter(u => u.invitedBy === me.invitedBy).forEach(u => push(u, u.paid ? 'paid' : 'node')); // соседи
  }

  res.json({ linked: !!me.code, friends: [...out.values()] });
});

app.get('/health', (_, res) => res.json({ ok: true, users: users.size }));

app.listen(PORT, () => console.log(`API на :${PORT}`));
bot.start();
