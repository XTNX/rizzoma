/* Интеграционные тесты приёма Telegram-апдейтов.
   Настоящий bot.js импортируется как модуль и получает синтетические Update
   через bot.handleUpdate() — ни сети, ни Telegram, ни токена не нужно.
   Проверяется именно проводка: фильтры чата, отсев ботов, дедуп, откат.
   Запуск: node --test tests/ */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const TOKEN = '424242:AAtest_bot_token_for_unit_tests_xxx';
const CHANNEL = -1001111111111;
const DISCUSSION = -1002222222222;
const FOREIGN = -1009999999999;

process.env.BOT_TOKEN     = TOKEN;
process.env.APP_URL       = 'https://example.test/app';
process.env.CHANNEL_ID    = String(CHANNEL);
process.env.DISCUSSION_ID = String(DISCUSSION);
process.env.ADMIN_TG_IDS  = '777';
process.env.PORT          = '0';

const { bot, app, ALLOWED_UPDATES, engagementOf } = await import('../bot/bot.js');

let server, base;
before(async () => {
  // грамми не пойдёт в сеть за getMe, если информация о боте уже задана
  bot.botInfo = {
    id: 424242, is_bot: true, first_name: 'RizzomaTest', username: 'rizzoma_test_bot',
    can_join_groups: true, can_read_all_group_messages: true, supports_inline_queries: false
  };
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());

/* ---------- фабрики апдейтов (форма — из Bot API) ---------- */
let uid = 0;
const nextId = () => ++uid;
const user = (id, extra = {}) =>
  Object.assign({id, is_bot:false, first_name:'Тестер' + id, username:'t' + id}, extra);

const reaction = (u, msgId, chatId = CHANNEL, emoji = '❤') => ({
  update_id: nextId(),
  message_reaction: {
    chat: {id: chatId, type:'channel', title:'rizzoma'},
    message_id: msgId, user: u, date: Math.floor(Date.now()/1000),
    old_reaction: [], new_reaction: emoji ? [{type:'emoji', emoji}] : []
  }
});
const joined = (u, chatId = CHANNEL, from = 'left', to = 'member') => ({
  update_id: nextId(),
  chat_member: {
    chat: {id: chatId, type:'channel', title:'rizzoma'},
    from: u, date: Math.floor(Date.now()/1000),
    old_chat_member: {status: from, user: u},
    new_chat_member: {status: to, user: u}
  }
});
const boosted = (u, boostId, chatId = CHANNEL) => ({
  update_id: nextId(),
  chat_boost: {
    chat: {id: chatId, type:'channel', title:'rizzoma'},
    boost: {
      boost_id: boostId, add_date: Math.floor(Date.now()/1000),
      expiration_date: Math.floor(Date.now()/1000) + 86400,
      source: {source:'premium', user: u}
    }
  }
});
const boostGone = (u, boostId, chatId = CHANNEL) => ({
  update_id: nextId(),
  removed_chat_boost: {
    chat: {id: chatId, type:'channel', title:'rizzoma'},
    boost_id: boostId, remove_date: Math.floor(Date.now()/1000),
    source: {source:'premium', user: u}
  }
});
const comment = (u, msgId, chatId = DISCUSSION, extra = {}) => ({
  update_id: nextId(),
  message: Object.assign({
    message_id: msgId, from: u, date: Math.floor(Date.now()/1000),
    chat: {id: chatId, type:'supergroup', title:'rizzoma chat'},
    text: 'пойду'
  }, extra)
});

const initData = u => {
  const p = new URLSearchParams();
  p.set('auth_date', String(Math.floor(Date.now()/1000)));
  p.set('user', JSON.stringify(u));
  const dcs = [...p.entries()].map(([k,v]) => `${k}=${v}`).sort().join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  p.set('hash', crypto.createHmac('sha256', secret).update(dcs).digest('hex'));
  return p.toString();
};
const api = async (path, body) => {
  const r = await fetch(base + path, {
    method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)
  });
  return {status: r.status, body: await r.json().catch(() => null)};
};

/* ============================ тесты ============================ */

test('allowed_updates назван явно — иначе Telegram не пришлёт эти типы', () => {
  ['message','chat_member','message_reaction','chat_boost','removed_chat_boost']
    .forEach(t => assert.ok(ALLOWED_UPDATES.includes(t), 'нет типа ' + t));
});

test('реакция в канале начисляет баллы', async () => {
  const u = user(1001);
  await bot.handleUpdate(reaction(u, 71));
  assert.equal(engagementOf(u.id).points, 2);
  assert.equal(engagementOf(u.id).events[0].rule, 'reaction');
});

test('повтор того же апдейта не удваивает баллы', async () => {
  const u = user(1002);
  const upd = reaction(u, 71);
  await bot.handleUpdate(upd);
  await bot.handleUpdate({...upd, update_id: nextId()});    // Telegram умеет повторять доставку
  assert.equal(engagementOf(u.id).points, 2);
  assert.equal(engagementOf(u.id).events.length, 1);
});

test('реакции на разные посты считаются отдельно', async () => {
  const u = user(1003);
  await bot.handleUpdate(reaction(u, 68));
  await bot.handleUpdate(reaction(u, 71));
  assert.equal(engagementOf(u.id).points, 4);
});

test('снятие реакции не отнимает баллы и не добавляет', async () => {
  const u = user(1004);
  await bot.handleUpdate(reaction(u, 71));
  await bot.handleUpdate(reaction(u, 71, CHANNEL, null));   // new_reaction пустой
  assert.equal(engagementOf(u.id).points, 2);
});

test('чужой чат игнорируется полностью', async () => {
  const u = user(1005);
  await bot.handleUpdate(reaction(u, 71, FOREIGN));
  await bot.handleUpdate(joined(u, FOREIGN));
  await bot.handleUpdate(boosted(u, 'bF', FOREIGN));
  assert.equal(engagementOf(u.id).points, 0);
});

test('бот баллы не зарабатывает', async () => {
  const b = user(1006, {is_bot:true});
  await bot.handleUpdate(reaction(b, 71));
  assert.equal(engagementOf(b.id).points, 0);
});

test('анонимная реакция от лица канала не роняет обработчик', async () => {
  const upd = reaction(user(1007), 71);
  delete upd.message_reaction.user;                          // вместо user приходит actor_chat
  upd.message_reaction.actor_chat = {id: CHANNEL, type:'channel', title:'rizzoma'};
  await bot.handleUpdate(upd);                               // не должно бросить
  assert.equal(engagementOf(1007).points, 0);
});

test('подписка начисляется один раз, даже после отписки и возврата', async () => {
  const u = user(1008);
  await bot.handleUpdate(joined(u));
  assert.equal(engagementOf(u.id).points, 5);
  await bot.handleUpdate(joined(u, CHANNEL, 'member', 'left'));   // ушёл
  await bot.handleUpdate(joined(u));                              // вернулся
  assert.equal(engagementOf(u.id).points, 5);
});

test('повышение до админа не считается новой подпиской', async () => {
  const u = user(1009);
  await bot.handleUpdate(joined(u));
  await bot.handleUpdate(joined(u, CHANNEL, 'member', 'administrator'));
  assert.equal(engagementOf(u.id).points, 5);
});

test('буст начисляет, снятие списывает ровно его, второе снятие — нет', async () => {
  const u = user(1010);
  await bot.handleUpdate(boosted(u, 'b1'));
  assert.equal(engagementOf(u.id).points, 15);
  await bot.handleUpdate(boostGone(u, 'b1'));
  assert.equal(engagementOf(u.id).points, 0);
  await bot.handleUpdate(boostGone(u, 'b1'));
  assert.equal(engagementOf(u.id).points, 0);
});

test('снятие одного буста не трогает второй', async () => {
  const u = user(1011);
  await bot.handleUpdate(boosted(u, 'b1'));
  await bot.handleUpdate(boosted(u, 'b2'));
  assert.equal(engagementOf(u.id).points, 30);
  await bot.handleUpdate(boostGone(u, 'b1'));
  assert.equal(engagementOf(u.id).points, 15);
});

test('комментарий в группе обсуждений начисляет, потолок держит', async () => {
  const u = user(1012);
  for(let i = 1; i <= 5; i++) await bot.handleUpdate(comment(u, i));
  assert.equal(engagementOf(u.id).points, 15);
  await bot.handleUpdate(comment(u, 6));                      // шестой за сутки
  assert.equal(engagementOf(u.id).points, 15);
});

test('автопересылка поста канала в обсуждение баллов не даёт', async () => {
  const u = user(1013);
  await bot.handleUpdate(comment(u, 1, DISCUSSION, {
    is_automatic_forward: true,
    sender_chat: {id: CHANNEL, type:'channel', title:'rizzoma'}
  }));
  assert.equal(engagementOf(u.id).points, 0);
});

test('личное сообщение боту баллов не даёт', async () => {
  const u = user(1014);
  await bot.handleUpdate(comment(u, 1, u.id, {chat: {id: u.id, type:'private'}}));
  assert.equal(engagementOf(u.id).points, 0);
});

test('/api/engagement отдаёт баллы владельцу и режет чужое', async () => {
  const u = user(1015);
  await bot.handleUpdate(reaction(u, 71));
  await bot.handleUpdate(joined(u));

  const mine = await api('/api/engagement', {initData: initData(u)});
  assert.equal(mine.status, 200);
  assert.equal(mine.body.points, 7);
  assert.equal(mine.body.events.length, 2);
  assert.equal(mine.body.tracking, 'on');

  const other = await api('/api/engagement', {initData: initData(user(1016))});
  assert.equal(other.body.points, 0);          // чужие баллы не видны
});

test('/api/engagement без подписи и с испорченной подписью — 401', async () => {
  assert.equal((await api('/api/engagement', {})).status, 401);
  const bad = initData(user(1017)) + 'x';
  assert.equal((await api('/api/engagement', {initData: bad})).status, 401);
});

test('мусорный апдейт не роняет процесс', async () => {
  await bot.handleUpdate({update_id: nextId(), message_reaction: {chat:{id:CHANNEL}, message_id:1}});
  await bot.handleUpdate({update_id: nextId(), chat_boost: {chat:{id:CHANNEL}, boost:{boost_id:'x'}}});
  assert.ok(true);
});
