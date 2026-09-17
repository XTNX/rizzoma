/* Общие подпорки e2e: подмена Telegram-SDK и config.js.
   Внутри Telegram приложение ведёт себя иначе (allowlist админки, системные
   кнопки), а тянуть настоящий Telegram в CI нельзя — поэтому SDK
   подменяется заглушкой на уровне сети. */

export const APP = '/index.html?e2e=1';

/* Минимальный WebApp: ровно те методы, которые приложение реально зовёт. */
const stub = uid => `
window.Telegram = { WebApp: {
  platform:'ios', version:'7.10', initData:'e2e-stub',
  initDataUnsafe:{ user:{ id:${uid}, first_name:'Tester', username:'tester' } },
  viewportStableHeight: window.innerHeight,
  safeAreaInset:{top:0,bottom:0}, contentSafeAreaInset:{top:0,bottom:0},
  isVersionAtLeast(){ return true; },
  ready(){}, expand(){}, close(){},
  setHeaderColor(){}, setBackgroundColor(){},
  enableClosingConfirmation(){}, disableVerticalSwipes(){},
  onEvent(){}, offEvent(){},
  openInvoice(){}, openTelegramLink(){}, openLink(){},
  HapticFeedback:{ impactOccurred(){}, notificationOccurred(){}, selectionChanged(){} },
  MainButton:{ setParams(){return this;}, setText(){return this;}, enable(){return this;},
               disable(){return this;}, show(){return this;}, hide(){return this;},
               showProgress(){return this;}, hideProgress(){return this;},
               onClick(){return this;}, offClick(){return this;} },
  BackButton:{ show(){return this;}, hide(){return this;},
               onClick(){return this;}, offClick(){return this;} }
}};`;

/** Открыть приложение. opts: {tg:false|id, config:{…}} */
export async function open(page, opts = {}){
  const cfg = Object.assign({
    bot:'', app:'', apiBase:'', crewDemo:true,
    prices:{std:null, vip:null}, betaOpen:null, admins:[], qaButton:true
  }, opts.config || {});

  await page.route('**/telegram-web-app.js', route => route.fulfill({
    contentType: 'text/javascript',
    body: opts.tg ? stub(opts.tg) : 'window.Telegram = undefined;'
  }));
  await page.route('**/config.js', route => route.fulfill({
    contentType: 'text/javascript',
    body: 'window.RIZZOMA_CONFIG = ' + JSON.stringify(cfg) + ';'
  }));
  await page.goto(APP + (opts.query || ''));
  await page.waitForFunction(() => !!window.__RZ);
}

/** Пройти ритуал запуска: до развёртки сцена на жесты не реагирует. */
export async function boot(page){
  await page.locator('#bootBtn').click();
  await page.waitForFunction(() => window.__RZ.boot() === 'ready', null, {timeout: 8000});
  await page.waitForTimeout(150);
}

/** Выставить число приглашённых через QA-панель (она же правит локальную БД). */
export async function setRefs(page, n){
  await page.evaluate(() => { document.querySelector('#qaBtn').click(); });
  await page.locator('#admRefs').fill(String(n));
  await page.locator('[data-adm="setrefs"]').click();
  await page.locator('#admHost .sheet__close').click();
  await page.waitForTimeout(250);
}

/** Экранные координаты узла дерева (узлы живут на канве, не в DOM). */
export async function nodeAt(page, tier){
  const n = await page.evaluate(i => window.__RZ.node(i), tier);
  const box = await page.locator('#tree').boundingBox();
  return {x: box.x + n.x, y: box.y + n.y, st: n.st};
}
