/* ============================================================
   RIZZOMA — баллы за активность в Telegram-канале.

   Отдельная от economy.js система: дерево узлов считает рефералов,
   эта — действия в t.me/rizzoma26. Пересечений в данных нет.

   Файл читается и как браузерный скрипт (window.RIZZOMA_ENGAGEMENT),
   и как CommonJS-модуль — по нему считают клиент, бэкенд и тесты.

   Начисление и отмена живут здесь целиком и чистыми функциями:
   бэкенд только хранит Map «tgId → ledger» и зовёт award/revoke,
   поэтому всю механику (дедуп, суточный потолок, откат буста)
   можно проверить юнит-тестами без Telegram и без сети.
   ============================================================ */
(function(root, factory){
  const api = factory();
  root.RIZZOMA_ENGAGEMENT = api;
  if(typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
'use strict';

/* once:'user'    — один раз на пользователя (повторная подписка не платит)
   once:'subject' — один раз на пару «пользователь + объект» (пост, буст)
   daily          — потолок засчитанных событий в сутки, если нужен  */
const RULES = [
  {key:'join',     points:5,  once:'user',    label:'Подписка на канал'},
  {key:'reaction', points:2,  once:'subject', label:'Реакция на пост'},
  {key:'boost',    points:15, once:'subject', label:'Буст канала'},
  {key:'comment',  points:3,  once:'subject', label:'Комментарий', daily:5}
];

const ruleOf    = key => RULES.find(r => r.key === key) || null;
const pointsFor = key => { const r = ruleOf(key); return r ? r.points : 0; };
const labelOf   = key => { const r = ruleOf(key); return r ? r.label : String(key); };

/* Ключ дедупликации. Он же лежит в самом событии — отдельного «журнала
   виденного» не нужно, а значит нечему разъехаться с балансом. */
function dedupKey(ruleKey, userId, subject){
  const r = ruleOf(ruleKey);
  if(!r || userId === null || userId === undefined || userId === '') return null;
  return r.once === 'user' ? `${ruleKey}:${userId}`
                           : `${ruleKey}:${userId}:${subject}`;
}

const emptyLedger = () => ({points:0, events:[]});
const totalFor = events => (events || []).reduce((s, e) => s + (+e.points || 0), 0);

const DAY = 24*60*60*1000;
/* Сколько событий этого правила засчитано за последние сутки. */
function dailyCount(events, ruleKey, now){
  const t = now || Date.now();
  return (events || []).filter(e => e.rule === ruleKey && t - (+e.ts || 0) < DAY).length;
}
function underDailyCap(events, ruleKey, now){
  const r = ruleOf(ruleKey);
  if(!r || !r.daily) return true;
  return dailyCount(events, ruleKey, now) < r.daily;
}

/* Начисление. Возвращает НОВЫЙ ledger — исходный не меняется, поэтому
   вызывающий код не может случайно засчитать половину операции.
   reason: 'unknown-rule' | 'dup' | 'cap' — почему не начислено. */
function award(ledger, {rule, userId, subject, ts} = {}){
  const base = ledger && Array.isArray(ledger.events) ? ledger : emptyLedger();
  const r = ruleOf(rule);
  const key = dedupKey(rule, userId, subject);
  if(!r || !key) return {ledger: base, ok:false, reason:'unknown-rule', key:null};
  if(base.events.some(e => e.key === key)) return {ledger: base, ok:false, reason:'dup', key};
  const when = ts || Date.now();
  if(!underDailyCap(base.events, rule, when)) return {ledger: base, ok:false, reason:'cap', key};

  const event = {key, rule, points: r.points, subject: subject === undefined ? null : subject, ts: when};
  const events = base.events.concat([event]);
  return {ledger: {points: totalFor(events), events}, ok:true, reason:null, key, event};
}

/* Отмена — например, снятый буст. Списывает ровно то, что было начислено
   этим событием, а не фиксированную сумму: если правила поменяются,
   старые начисления всё равно откатятся правильно. */
function revoke(ledger, {rule, userId, subject} = {}){
  const base = ledger && Array.isArray(ledger.events) ? ledger : emptyLedger();
  const key = dedupKey(rule, userId, subject);
  const hit = key && base.events.find(e => e.key === key);
  if(!hit) return {ledger: base, ok:false, points:0, key};
  const events = base.events.filter(e => e.key !== key);
  return {ledger: {points: totalFor(events), events}, ok:true, points: hit.points, key};
}

return {
  RULES, ruleOf, pointsFor, labelOf,
  dedupKey, emptyLedger, totalFor,
  dailyCount, underDailyCap, award, revoke
};
});
