/* Юнит-тесты баллов за активность: те же функции, по которым считает
   бэкенд и рисует клиент. Без Telegram, без сети.
   Запуск: node --test tests/ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('../engagement.js');

const T0 = Date.UTC(2026, 8, 22, 12, 0, 0);
const HOUR = 60*60*1000, DAY = 24*HOUR;

test('правила объявлены и не потеряли баллы', () => {
  assert.deepEqual(E.RULES.map(r => r.key), ['join','reaction','boost','comment']);
  assert.equal(E.pointsFor('join'), 5);
  assert.equal(E.pointsFor('reaction'), 2);
  assert.equal(E.pointsFor('boost'), 15);
  assert.equal(E.pointsFor('comment'), 3);
  assert.equal(E.pointsFor('нет такого'), 0);
  assert.equal(E.labelOf('reaction'), 'Реакция на пост');
});

test('ключ дедупа: подписка — на пользователя, остальное — на объект', () => {
  assert.equal(E.dedupKey('join', 999, 'что угодно'), 'join:999');   // объект игнорируется
  assert.equal(E.dedupKey('reaction', 999, 71), 'reaction:999:71');
  assert.notEqual(E.dedupKey('reaction', 999, 71), E.dedupKey('reaction', 999, 72));
  assert.notEqual(E.dedupKey('reaction', 999, 71), E.dedupKey('reaction', 1000, 71));
  assert.equal(E.dedupKey('reaction', null, 71), null);              // нет пользователя — нет ключа
  assert.equal(E.dedupKey('левое', 999, 1), null);
});

test('начисление складывается и попадает в события', () => {
  let L = E.emptyLedger();
  assert.equal(L.points, 0);
  L = E.award(L, {rule:'join', userId:999, ts:T0}).ledger;
  L = E.award(L, {rule:'reaction', userId:999, subject:71, ts:T0}).ledger;
  assert.equal(L.points, 7);
  assert.equal(L.events.length, 2);
  assert.equal(E.totalFor(L.events), 7);
  assert.equal(L.events[1].rule, 'reaction');
  assert.equal(L.events[1].subject, 71);
});

test('повторное событие не удваивает баллы', () => {
  let L = E.emptyLedger();
  const first = E.award(L, {rule:'reaction', userId:999, subject:71, ts:T0});
  assert.equal(first.ok, true);
  const again = E.award(first.ledger, {rule:'reaction', userId:999, subject:71, ts:T0 + HOUR});
  assert.equal(again.ok, false);
  assert.equal(again.reason, 'dup');
  assert.equal(again.ledger.points, 2);
  assert.equal(again.ledger.events.length, 1);
});

test('повторная подписка после отписки не платит второй раз', () => {
  let L = E.award(E.emptyLedger(), {rule:'join', userId:999, ts:T0}).ledger;
  const again = E.award(L, {rule:'join', userId:999, ts:T0 + 30*DAY});
  assert.equal(again.ok, false);
  assert.equal(again.ledger.points, 5);
});

test('реакции на разные посты считаются отдельно', () => {
  let L = E.emptyLedger();
  [68, 71, 74].forEach(id => { L = E.award(L, {rule:'reaction', userId:999, subject:id, ts:T0}).ledger; });
  assert.equal(L.points, 6);
  assert.equal(L.events.length, 3);
});

test('суточный потолок комментариев', () => {
  let L = E.emptyLedger();
  for(let i = 1; i <= 5; i++) L = E.award(L, {rule:'comment', userId:999, subject:i, ts:T0}).ledger;
  assert.equal(L.points, 15);
  assert.equal(E.dailyCount(L.events, 'comment', T0), 5);

  const over = E.award(L, {rule:'comment', userId:999, subject:6, ts:T0 + HOUR});
  assert.equal(over.ok, false);
  assert.equal(over.reason, 'cap');
  assert.equal(over.ledger.points, 15);

  // сутки прошли — потолок отпустил
  const next = E.award(L, {rule:'comment', userId:999, subject:7, ts:T0 + DAY + HOUR});
  assert.equal(next.ok, true);
  assert.equal(next.ledger.points, 18);
});

test('потолок не трогает правила без него', () => {
  let L = E.emptyLedger();
  for(let i = 1; i <= 20; i++) L = E.award(L, {rule:'reaction', userId:999, subject:i, ts:T0}).ledger;
  assert.equal(L.points, 40);
  assert.equal(E.underDailyCap(L.events, 'reaction', T0), true);
});

test('снятый буст списывает ровно своё начисление', () => {
  let L = E.award(E.emptyLedger(), {rule:'boost', userId:999, subject:'b1', ts:T0}).ledger;
  L = E.award(L, {rule:'reaction', userId:999, subject:71, ts:T0}).ledger;
  assert.equal(L.points, 17);

  const off = E.revoke(L, {rule:'boost', userId:999, subject:'b1'});
  assert.equal(off.ok, true);
  assert.equal(off.points, 15);
  assert.equal(off.ledger.points, 2);          // реакция осталась
  assert.equal(off.ledger.events.length, 1);

  const twice = E.revoke(off.ledger, {rule:'boost', userId:999, subject:'b1'});
  assert.equal(twice.ok, false);               // второй раз не списывает
  assert.equal(twice.ledger.points, 2);
});

test('откат снимает начисленную сумму, даже если правило потом подорожало', () => {
  // событие, начисленное по старой цене
  const old = {ledger:{points:1, events:[{key:'boost:999:b1', rule:'boost', points:1, subject:'b1', ts:T0}]}};
  const off = E.revoke(old.ledger, {rule:'boost', userId:999, subject:'b1'});
  assert.equal(off.points, 1);                 // не 15 из текущих правил
  assert.equal(off.ledger.points, 0);
});

test('снятый буст можно начислить заново', () => {
  let L = E.award(E.emptyLedger(), {rule:'boost', userId:999, subject:'b1', ts:T0}).ledger;
  L = E.revoke(L, {rule:'boost', userId:999, subject:'b1'}).ledger;
  const back = E.award(L, {rule:'boost', userId:999, subject:'b1', ts:T0 + DAY});
  assert.equal(back.ok, true);
  assert.equal(back.ledger.points, 15);
});

test('ledger не меняется на месте — вызывающий не получит половину операции', () => {
  const L0 = E.emptyLedger();
  const res = E.award(L0, {rule:'join', userId:999, ts:T0});
  assert.equal(L0.points, 0);
  assert.equal(L0.events.length, 0);
  assert.equal(res.ledger.points, 5);
});

test('мусор на входе не роняет расчёт', () => {
  assert.equal(E.award(null, {rule:'join', userId:1}).ok, true);
  assert.equal(E.award(E.emptyLedger(), {}).ok, false);
  assert.equal(E.award(E.emptyLedger(), {rule:'join'}).ok, false);          // нет userId
  assert.equal(E.revoke(E.emptyLedger(), {rule:'boost', userId:1, subject:'x'}).ok, false);
  assert.equal(E.totalFor(null), 0);
  assert.equal(E.totalFor([{points:'2'},{points:null}]), 2);
});
