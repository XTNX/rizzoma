/* ============================================================
   RIZZOMA — экономика, тарифы и правила беты.

   Вынесено из index.html по двум причинам:
     1) числа и формулировки правятся в одном месте;
     2) те же функции считают цену в юнит-тестах — файл читается
        и как браузерный скрипт (window.RIZZOMA_ECONOMY),
        и как CommonJS-модуль (require из tests/).

   ⚠ Пороги узлов (n) — защищённый контракт: их не меняем.
     Тексты (skill/line/label) — подача, правятся свободно.
   ============================================================ */
(function(root, factory){
  const api = factory();
  root.RIZZOMA_ECONOMY = api;
  if(typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
'use strict';

/* ---------- лестница узлов ---------- */
const TIERS = [
  {n:1,   skill:'ПРОБИТИЕ',     line:'−20% на свой билет',            label:'Скидка 20% на билет'},
  {n:3,   skill:'ПРОХОД',       line:'Свой билет бесплатно',          label:'Бесплатная проходка'},
  {n:5,   skill:'КАПСУЛА',      line:'Проходка + мерч',               label:'Проходка + мерч (капсула движения)'},
  {n:10,  skill:'ОБХОД',        line:'Вход без очереди',              label:'Проходка + мерч + скип очереди / гест-лист'},
  {n:15,  skill:'ГЛУБИНА',      line:'VIP-зона без наценки',          label:'VIP-проходка: доступ в VIP-зону'},
  {n:25,  skill:'РЕЛИКТ',       line:'VIP + лимитная капсула',        label:'VIP + лимитированная мерч-капсула'},
  {n:40,  skill:'КОНТУР',       line:'Год ивентов + знакомство с артистами', label:'Годовой абонемент на все ивенты + встреча с артистами'},
  {n:60,  skill:'РЕЗИДЕНТ',     line:'−50% навсегда + закрытые ивенты', label:'Статус «Резидент»: пожизненная скидка 50% + закрытые ивенты'},
  {n:80,  skill:'ВЕЧНАЯ ВЕТВЬ', line:'Один формат ивентов навсегда',  label:'Пожизненная проходка на один формат ивентов'},
  {n:100, skill:'ТОТЕМ',        line:'Все ивенты навсегда + твой знак в сети', label:'Пожизненная максимальная проходка + именной тотем в сети'}
];

/* Три ветви — только группировка узлов по смыслу награды.
     ВОЛЯ  — билеты и проходки        (1, 3, 10)
     ТЕЛО  — мерч, вещи, знак         (5, 25, 100)
     РАЗУМ — VIP и пожизненное        (15, 40, 60, 80) */
const BRANCHES = [
  {rom:'I',   name:'ВОЛЯ',  hint:'билеты и проходки', idx:[0,1,3]},
  {rom:'II',  name:'ТЕЛО',  hint:'мерч и вещи',       idx:[2,5,9]},
  {rom:'III', name:'РАЗУМ', hint:'VIP и навсегда',    idx:[4,6,7,8]}
];

/* ---------- что открыто в бете ----------
   Бета проверяет один сценарий: пригласил → получил проходку.
   Поэтому открыта вся ветвь ВОЛЯ (билеты) и ровно одна VIP-привилегия
   ГЛУБИНА. Мерч и пожизненные бонусы закрыты туманом: узлы остаются
   на сцене, но в тесте не участвуют — это не «не хватает рефералов».  */
const BETA_OPEN = [0, 1, 3, 4];
const VIP_TIER = 4;                       // ГЛУБИНА — VIP-зона без наценки

/* ---------- билет: состав × класс ----------
   base = null значит «цена не объявлена»: в UI «уточняется», оплата
   заблокирована. Реальные числа приходят из config.js → prices,
   чтобы правка цены не требовала правки кода.                        */
const TICKET_CLASS = [
  {id:'std', name:'Обычный', base:null, note:'общий вход'},
  {id:'vip', name:'VIP',     base:null, note:'вход + VIP-зона'}
];
const TICKET_SIZE = [
  {id:'solo', name:'Одиночный', qty:1},
  {id:'duo',  name:'Парный',    qty:2},
  {id:'trio', name:'Тройной',   qty:3}
];

const classOf = id => TICKET_CLASS.find(c => c.id === id) || null;
const sizeOf  = id => TICKET_SIZE.find(s => s.id === id) || null;

/* ---------- уровни ---------- */
const tierIndex = c => { let i = -1; TIERS.forEach((t, k) => { if(c >= t.n) i = k; }); return i; };
const tierName  = c => 'TIER_' + String(tierIndex(c) + 1).padStart(2, '0');
const branchOf  = i => BRANCHES.findIndex(b => b.idx.indexOf(i) >= 0);

const isOpen = (i, open) => (open || BETA_OPEN).indexOf(i) >= 0;
/* ближайший узел, до которого реально можно дойти в бете */
function nextOpenTier(refs, claimed, open){
  const list = claimed || [];
  for(let i = 0; i < TIERS.length; i++){
    if(!isOpen(i, open)) continue;
    if(list.indexOf(i) >= 0) continue;
    if(refs < TIERS[i].n) return i;
  }
  return -1;
}

/* ---------- деньги ---------- */
const money = n => new Intl.NumberFormat('ru-RU').format(n) + ' ₽';
const priceLabel = p => p === null ? 'уточняется' : (p === 0 ? '0 ₽' : money(p));

/* Цена одной проходки по классу: config.prices перекрывает базу. */
function classBase(clsId, prices){
  const c = classOf(clsId);
  if(!c) return null;
  const p = prices && prices[clsId];
  if(typeof p === 'number' && isFinite(p) && p >= 0) return Math.round(p);
  return c.base === null ? null : c.base;
}

/* Лестница скиллов на ОДНУ проходку: 3+ узла — бесплатно, 1–2 — минус 20%. */
function effPrice(base, c){
  if(c >= 3) return 0;
  if(base === null) return null;
  if(c >= 1) return Math.round(base * 0.8);
  return base;
}

/* Итог за комбинацию «класс × состав».
   Скиллы дерева закрывают СВОЮ проходку, остальные места в парном и
   тройном билете идут по полной цене — иначе один узел обнулял бы
   сразу три входа. ГЛУБИНА снимает VIP-наценку с собственной проходки. */
function comboPrice(clsId, sizeId, refs, opts){
  opts = opts || {};
  const size = sizeOf(sizeId);
  if(!size) return null;                      // неизвестный состав не считаем как одиночный
  const b = classBase(clsId, opts.prices);
  // цена не объявлена — но своя проходка уже бесплатна, и одиночный билет
  // считается даже без чисел: скилл ПРОХОД работает раньше прайса
  if(b === null) return (refs >= TIERS[1].n && size.qty === 1) ? 0 : null;
  const std = classBase('std', opts.prices);
  const ownBase = (clsId === 'vip' && opts.vipSkill && std !== null) ? std : b;
  const own = effPrice(ownBase, refs);
  return own + b * (size.qty - 1);
}

/* Почему цена такая — одной строкой под суммой чекаута. */
function priceNotes(clsId, sizeId, refs, opts){
  opts = opts || {};
  const out = [];
  if(refs >= 3)      out.push('своя проходка бесплатно · ' + TIERS[1].skill);
  else if(refs >= 1) out.push('−20% на свою проходку · ' + TIERS[0].skill);
  if(clsId === 'vip' && opts.vipSkill) out.push('VIP без наценки · ' + TIERS[VIP_TIER].skill);
  const size = sizeOf(sizeId);
  if(size && size.qty > 1) out.push((size.qty - 1) + ' место по полной цене');
  return out;
}

return {
  TIERS, BRANCHES, BETA_OPEN, VIP_TIER, TICKET_CLASS, TICKET_SIZE,
  classOf, sizeOf, classBase,
  tierIndex, tierName, branchOf, isOpen, nextOpenTier,
  money, priceLabel, effPrice, comboPrice, priceNotes
};
});
