/* Юнит-тесты экономики: считают то же, что приложение и бэкенд —
   economy.js подключается как есть, без сборки и без моков.
   Запуск: node --test tests/ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('../economy.js');

const P = {prices:{std:800, vip:1600}};
const price = (cls, size, refs, opts) => E.comboPrice(cls, size, refs, Object.assign({}, P, opts));

test('пороги узлов не изменились — это защищённый контракт', () => {
  assert.deepEqual(E.TIERS.map(t => t.n), [1,3,5,10,15,25,40,60,80,100]);
});

test('в бете открыты только билетные узлы и одна VIP-привилегия', () => {
  assert.deepEqual(E.BETA_OPEN, [0,1,3,4]);
  const names = E.BETA_OPEN.map(i => E.TIERS[i].skill);
  assert.deepEqual(names, ['ПРОБИТИЕ','ПРОХОД','ОБХОД','ГЛУБИНА']);
  // мерч (ветвь ТЕЛО) в бете не участвует
  const telo = E.BRANCHES[1].idx;
  assert.ok(telo.every(i => !E.isOpen(i)), 'ветвь ТЕЛО должна быть под туманом');
});

test('лестница скидок на одну проходку', () => {
  assert.equal(E.effPrice(800, 0), 800);
  assert.equal(E.effPrice(800, 1), 640);
  assert.equal(E.effPrice(800, 2), 640);
  assert.equal(E.effPrice(800, 3), 0);
  assert.equal(E.effPrice(800, 99), 0);
  assert.equal(E.effPrice(null, 0), null);
});

test('все шесть комбинаций «состав × класс» без рефералов', () => {
  assert.equal(price('std','solo',0), 800);
  assert.equal(price('std','duo', 0), 1600);
  assert.equal(price('std','trio',0), 2400);
  assert.equal(price('vip','solo',0), 1600);
  assert.equal(price('vip','duo', 0), 3200);
  assert.equal(price('vip','trio',0), 4800);
});

test('скилл закрывает только свою проходку, остальные места — по полной', () => {
  // 1 узел: −20% на своё место
  assert.equal(price('std','solo',1), 640);
  assert.equal(price('std','duo', 1), 640 + 800);
  assert.equal(price('std','trio',1), 640 + 1600);
  // 3 узла: своё место бесплатно, соседние нет
  assert.equal(price('std','solo',3), 0);
  assert.equal(price('std','duo', 3), 800);
  assert.equal(price('std','trio',3), 1600);
});

test('ГЛУБИНА снимает VIP-наценку с собственной проходки', () => {
  assert.equal(price('vip','solo',0,{vipSkill:true}), 800);          // своё место по обычной цене
  assert.equal(price('vip','duo', 0,{vipSkill:true}), 800 + 1600);   // второе — VIP по полной
  assert.equal(price('vip','solo',1,{vipSkill:true}), 640);          // и скидка сверху
  assert.equal(price('vip','solo',0,{vipSkill:false}), 1600);
});

test('цена не объявлена: «уточняется», но бесплатная проходка работает', () => {
  const none = {prices:{std:null, vip:null}};
  assert.equal(E.comboPrice('std','solo',0, none), null);
  assert.equal(E.comboPrice('std','duo', 3, none), null);
  assert.equal(E.comboPrice('std','solo',3, none), 0);
  assert.equal(E.priceLabel(null), 'уточняется');
});

test('неизвестный класс или состав не считается как обычный билет', () => {
  assert.equal(E.classBase('gold', P.prices), null);
  assert.equal(E.sizeOf('quad'), null);
  assert.equal(price('gold','solo',0), null);
  assert.equal(price('std','quad',0), null);      // не подменяется одиночным
});

test('уровень узла по числу приглашённых', () => {
  assert.equal(E.tierIndex(0), -1);
  assert.equal(E.tierIndex(1), 0);
  assert.equal(E.tierIndex(4), 1);
  assert.equal(E.tierIndex(100), 9);
  assert.equal(E.tierName(0), 'TIER_00');
  assert.equal(E.tierName(15), 'TIER_05');
});

test('следующая цель ведёт только к открытым в бете узлам', () => {
  assert.equal(E.nextOpenTier(0, []), 0);            // ПРОБИТИЕ
  assert.equal(E.nextOpenTier(1, [0]), 1);           // ПРОХОД
  assert.equal(E.nextOpenTier(4, [0,1]), 3);         // не КАПСУЛА (5, туман), а ОБХОД (10)
  assert.equal(E.nextOpenTier(12, [0,1,3]), 4);      // ГЛУБИНА
  assert.equal(E.nextOpenTier(99, [0,1,3,4]), -1);   // в бете забрано всё
});

test('туман правится списком: открытые узлы меняются вместе с ним', () => {
  assert.equal(E.isOpen(2, [0,1,2]), true);
  assert.equal(E.isOpen(4, [0,1,2]), false);
  assert.equal(E.nextOpenTier(0, [], [2]), 2);       // открыт только мерч — ведём к нему
});

test('подпись под суммой объясняет, откуда взялась цена', () => {
  assert.deepEqual(E.priceNotes('std','solo',0,P), []);
  assert.deepEqual(E.priceNotes('std','solo',1,P), ['−20% на свою проходку · ПРОБИТИЕ']);
  assert.deepEqual(E.priceNotes('std','duo', 3,P),
    ['своя проходка бесплатно · ПРОХОД', '1 место по полной цене']);
  assert.ok(E.priceNotes('vip','solo',0,{prices:P.prices, vipSkill:true})
             .some(s => s.indexOf('ГЛУБИНА') >= 0));
});
