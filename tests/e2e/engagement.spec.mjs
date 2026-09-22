/* Клиентская часть баллов за активность в канале: что показывает приложение,
   когда бэкенд отвечает, молчит или ещё не следит за каналом.
   Сам приём апдейтов от Telegram проверяется в tests/engagement.bot.test.mjs. */
import { test, expect } from '@playwright/test';
import { open, boot } from './helpers.mjs';

const API = 'http://api.test';

/** Поднять приложение «внутри Telegram» с заданным ответом /api/engagement. */
async function withApi(page, engagement, extra = {}){
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));

  await page.route('**/api/engagement', route => engagement
    ? route.fulfill({contentType:'application/json', body: JSON.stringify(engagement)})
    : route.fulfill({status: 503, contentType:'application/json', body: '{"error":"off"}'}));
  // остальные вызовы бэкенда в этом тесте не участвуют
  await page.route('**/api/visit',   r => r.fulfill({contentType:'application/json', body:'{"ok":true}'}));
  await page.route('**/api/state',   r => r.fulfill({contentType:'application/json', body:'{}'}));
  await page.route('**/api/friends', r => r.fulfill({contentType:'application/json', body:'{"linked":true,"friends":[]}'}));

  await open(page, Object.assign({tg: 5001, config:{apiBase: API, bot:'rizzoma_beta_bot', crewDemo:false}}, extra));
  await boot(page);
  await page.locator('[data-tab="crew"]').click();
  await page.waitForTimeout(500);
  return errors;
}

test('баллы и последние начисления видны во вкладке «Свои»', async ({page}) => {
  const errors = await withApi(page, {
    points: 22, tracking:'on',
    events: [
      {key:'boost:5001:b1',   rule:'boost',    points:15, subject:'b1', ts: Date.now()},
      {key:'reaction:5001:71',rule:'reaction', points:2,  subject:71,   ts: Date.now()},
      {key:'join:5001',       rule:'join',     points:5,  subject:null, ts: Date.now()}
    ]
  });

  const crew = page.locator('#crewBody');
  await expect(crew).toContainText('Активность в канале');
  await expect(crew.locator('.eng__sum b')).toHaveText('22');
  await expect(crew).toContainText('балла');                 // склонение
  await expect(crew.locator('.eng__list li')).toHaveCount(3);
  await expect(crew).toContainText('Буст канала');
  await expect(crew).toContainText('Реакция на пост');
  await expect(crew).toContainText('Подписка на канал');
  expect(errors).toEqual([]);
});

test('ноль баллов — это подсказка, а не пустой блок', async ({page}) => {
  const errors = await withApi(page, {points: 0, events: [], tracking:'on'});
  const crew = page.locator('#crewBody');
  await expect(crew.locator('.eng__sum b')).toHaveText('0');
  await expect(crew).toContainText('Подпишись на канал');
  expect(errors).toEqual([]);
});

test('бот не следит за каналом — говорим прямо, а не показываем ноль', async ({page}) => {
  const errors = await withApi(page, {points: 0, events: [], tracking:'off'});
  const crew = page.locator('#crewBody');
  await expect(crew).toContainText('Бот ещё не следит за каналом');
  await expect(crew.locator('.eng__sum')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('бэкенд молчит — блок не ломается и не врёт', async ({page}) => {
  const errors = await withApi(page, null);                  // 503 на /api/engagement
  const crew = page.locator('#crewBody');
  await expect(crew).toContainText('Активность в канале');
  await expect(crew).toContainText('Данных пока нет');
  expect(errors).toEqual([]);
});

test('вне Telegram честно сказано, где считаются баллы', async ({page}) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await open(page, {config:{crewDemo:false}});               // браузер, без Telegram
  await boot(page);
  await page.locator('[data-tab="crew"]').click();
  await expect(page.locator('#crewBody')).toContainText('Баллы считаются внутри Telegram');
  expect(errors).toEqual([]);
});

test('баллы лежат в localStorage и не уезжают в CloudStorage', async ({page}) => {
  await withApi(page, {points: 7, tracking:'on', events:[
    {key:'join:5001', rule:'join', points:5, subject:null, ts: Date.now()},
    {key:'reaction:5001:71', rule:'reaction', points:2, subject:71, ts: Date.now()}
  ]});

  // узел нужен, чтобы в CloudStorage вообще что-то уехало — есть с чем сравнивать
  await page.locator('#idBtn').click();
  await page.waitForTimeout(300);

  const local = await page.evaluate(() => {
    const raw = localStorage.getItem('rizzoma_engagement');
    return raw ? JSON.parse(raw) : null;
  });
  expect(local.points).toBe(7);
  expect(local.events.length).toBe(2);

  // решение из README: ключ намеренно локальный, как rizzoma_beta
  const cloudKeys = await page.evaluate(() => Object.keys(window.__cloud || {}));
  expect(cloudKeys).not.toContain('rizzoma_engagement');
  expect(cloudKeys).toContain('rizzoma_me');                 // а узел синхронизируется
});

test('кэш показывается до ответа сервера и не мешает дереву', async ({page}) => {
  await withApi(page, {points: 9, tracking:'on', events:[
    {key:'join:5001', rule:'join', points:5, subject:null, ts: Date.now()}
  ]});
  // перезагружаем со сломанным бэкендом: сумма должна остаться из кэша
  await page.route('**/api/engagement', r => r.abort());
  await page.reload();
  await page.waitForFunction(() => !!window.__RZ);
  await page.locator('#bootBtn').click();
  await page.waitForFunction(() => window.__RZ.boot() === 'ready', null, {timeout: 8000});
  await page.locator('[data-tab="crew"]').click();
  await expect(page.locator('#crewBody .eng__sum b')).toHaveText('9');
});
