/* Сценарии беты: туман, полосатая кромка, чекаут, доступ к админке.
   Запуск: npm run test:e2e */
import { test, expect } from '@playwright/test';
import { open, boot, setRefs, nodeAt } from './helpers.mjs';

const PRICES = {std:800, vip:1600};

test.describe('туман войны', () => {
  test('узел вне беты не активируется и говорит «вне беты», а не «нужно ещё»', async ({page}) => {
    await open(page);
    await boot(page);
    await setRefs(page, 99);                      // рефералов хватает на всё дерево

    // КАПСУЛА (индекс 2, мерч) в бете не участвует
    const fog = await nodeAt(page, 2);
    expect(fog.st).toBe(-1);

    // удержание на туманном узле не активирует скилл
    await page.mouse.move(fog.x, fog.y);
    await page.mouse.down();
    await page.waitForTimeout(1400);              // дольше, чем HOLD_MS
    await page.mouse.up();
    expect(await page.evaluate(() => window.__RZ.claims())).not.toContain(2);

    // тап открывает окно с другим текстом
    await page.mouse.click(fog.x, fog.y);
    const sheet = page.locator('#nodeSheet');
    await expect(sheet).toContainText('вне беты');
    await expect(sheet).toContainText('Не участвует в бете');
    await expect(sheet).not.toContainText('Ещё');
    await expect(sheet.locator('#holdBtn')).toHaveCount(0);
  });

  test('открытый узел активируется удержанием и не активируется коротким тапом', async ({page}) => {
    await open(page);
    await boot(page);
    await setRefs(page, 3);

    const n = await nodeAt(page, 0);              // ПРОБИТИЕ, порог 1
    expect(n.st).toBe(1);

    await page.mouse.click(n.x, n.y);             // короткий тап — только окно
    await expect(page.locator('#nodeSheet #holdBtn')).toBeVisible();
    expect(await page.evaluate(() => window.__RZ.claims())).toEqual([]);

    const hold = page.locator('#holdBtn');
    await hold.hover();          // лист выезжает анимацией: ждём, пока кнопка встанет
    await page.mouse.down();
    await page.waitForTimeout(400);
    await page.mouse.up();                        // отпустили раньше — отмена
    expect(await page.evaluate(() => window.__RZ.claims())).toEqual([]);

    await page.mouse.down();
    await page.waitForTimeout(1300);
    await page.mouse.up();
    expect(await page.evaluate(() => window.__RZ.claims())).toEqual([0]);
  });

  test('поле держит открытые ветви свободно, а упирается только в туман', async ({page}) => {
    await open(page);
    await boot(page);

    const canvas = page.locator('#tree');
    const box = await canvas.boundingBox();
    // на зуме узлы разъезжаются — именно там ограничение и начинает мешать
    for(let i = 0; i < 8; i++) await page.mouse.wheel(0, -120);
    await page.waitForTimeout(700);

    const B = await page.evaluate(() => window.__RZ.bounds());
    const fog = await page.evaluate(() => ({
      pullDown: window.__RZ.fogAhead('y', 1),   // вниз открывается ВОЛЯ — она в бете
      pullUp:   window.__RZ.fogAhead('y', -1)   // вверх открывается мерч — он под туманом
    }));
    expect(fog.pullDown).toBe(false);
    expect(fog.pullUp).toBe(true);
    // в сторону открытой ветви поле едет заметно дальше, чем в сторону тумана
    expect(B.y2).toBeGreaterThan(Math.abs(B.y1) * 1.4);

    // тянем в открытую сторону: сигнальной штриховки быть не должно
    const red = async () => page.evaluate(() => {
      const c = document.querySelector('#tree');
      const g = c.getContext('2d');
      const k = c.width/c.clientWidth;
      const d = g.getImageData(0, 0, c.width, Math.round(60*k)).data;   // верхняя кромка
      let n = 0;
      for(let i = 0; i < d.length; i += 4)
        if(d[i] > 90 && d[i] > d[i+1] + 40 && d[i] > d[i+2] + 20) n++;
      return n;
    });
    await page.mouse.move(box.x + box.width/2, box.y + 80);
    await page.mouse.down();
    for(let i = 1; i <= 16; i++) await page.mouse.move(box.x + box.width/2, box.y + 80 + i*45);
    await page.waitForTimeout(120);
    expect(await red()).toBeLessThan(50);
    await page.mouse.up();
  });

  test('на кромке поля проступает полосатая текстура', async ({page}) => {
    await open(page);
    await boot(page);

    const canvas = page.locator('#tree');
    const box = await canvas.boundingBox();
    const y = box.y + box.height/2;
    await page.mouse.move(box.x + 30, y);
    await page.mouse.down();
    for(let i = 1; i <= 8; i++) await page.mouse.move(box.x + 30 + i*40, y);   // тянем за предел
    await page.waitForTimeout(120);

    // ищем красные пиксели сигнальной штриховки у левой кромки
    const red = await page.evaluate(() => {
      const c = document.querySelector('#tree');
      const g = c.getContext('2d');
      const d = g.getImageData(0, 0, Math.round(40*(c.width/c.clientWidth)), c.height).data;
      let n = 0;
      for(let i = 0; i < d.length; i += 4)
        if(d[i] > 90 && d[i] > d[i+1] + 40 && d[i] > d[i+2] + 20) n++;
      return n;
    });
    await page.mouse.up();
    expect(red).toBeGreaterThan(200);

    // отпустили — резинка вернула поле, штриховки больше нет
    await page.waitForTimeout(900);
    const after = await page.evaluate(() => {
      const c = document.querySelector('#tree');
      const g = c.getContext('2d');
      const d = g.getImageData(0, 0, Math.round(40*(c.width/c.clientWidth)), c.height).data;
      let n = 0;
      for(let i = 0; i < d.length; i += 4)
        if(d[i] > 90 && d[i] > d[i+1] + 40 && d[i] > d[i+2] + 20) n++;
      return n;
    });
    expect(after).toBeLessThan(red/4);
  });
});

test.describe('чекаут', () => {
  test('все шесть комбинаций «состав × класс» считаются', async ({page}) => {
    await open(page, {config:{prices:PRICES}});
    await boot(page);
    await page.locator('#ticketFab').click();

    const sum = page.locator('.order .sum');
    const cases = [
      ['solo','std','800 ₽'], ['duo','std','1 600 ₽'], ['trio','std','2 400 ₽'],
      ['solo','vip','1 600 ₽'], ['duo','vip','3 200 ₽'], ['trio','vip','4 800 ₽']
    ];
    for(const [size, cls, want] of cases){
      await page.locator(`[data-size="${size}"]`).click();
      await page.locator(`[data-cls="${cls}"]`).click();
      await expect(sum).toHaveText(want);
    }
  });

  test('скидка за узлы применяется только к своей проходке', async ({page}) => {
    await open(page, {config:{prices:PRICES}});
    await boot(page);
    await setRefs(page, 3);                       // ПРОХОД: своя проходка бесплатно
    await page.locator('#ticketFab').click();

    await page.locator('[data-size="solo"]').click();
    await expect(page.locator('.order .sum')).toHaveText('0 ₽');
    await page.locator('[data-size="duo"]').click();
    await expect(page.locator('.order .sum')).toHaveText('800 ₽');
    await expect(page.locator('.disc')).toContainText('ПРОХОД');
  });

  test('двойной сабмит не создаёт вторую запись покупателя', async ({page}) => {
    await open(page, {config:{prices:PRICES}});
    await boot(page);
    await page.locator('#ticketFab').click();
    await page.locator('[data-fill="4242424242424242"]').click();

    await page.locator('#payBtn').click();
    await page.locator('#payBtn').click({force:true}).catch(() => {});   // второй раз, пока летит первый
    await expect(page.locator('.pass')).toBeVisible({timeout: 6000});

    const buyers = await page.evaluate(() => {
      const db = JSON.parse(localStorage.getItem('rizzoma_mock_db') || '{}');
      return Object.keys(db.buyers || {}).length;
    });
    expect(buyers).toBe(1);
  });
});

test.describe('доступ к бета-админке', () => {
  test('внутри Telegram тестер не открывает панель ни одним из входов', async ({page}) => {
    await open(page, {tg: 999, query: '&admin=1'});   // id 999 не в admins

    // ?admin=1 отрабатывает сразу на старте — и получает отказ
    await expect(page.locator('#admHost')).toBeHidden();
    await expect(page.locator('#toast')).toContainText('Раздел недоступен');
    await expect(page.locator('#qaBtn')).toBeHidden();
    await boot(page);

    // пять тапов подряд: серия считается только в пределах 600 мс, поэтому
    // кликаем в одном тике, а не через отдельные раунды к браузеру
    await page.evaluate(() => {
      const b = document.querySelector('#idBtn');
      for(let i = 0; i < 5; i++) b.click();
    });
    await page.waitForTimeout(300);
    await expect(page.locator('#admHost')).toBeHidden();
  });

  test('по ссылке тестера панели нет даже в браузере', async ({page}) => {
    await open(page, {config:{panel:false, qaButton:false}, query:'&admin=1'});
    await expect(page.locator('#admHost')).toBeHidden();
    await expect(page.locator('#qaBtn')).toBeHidden();
    await boot(page);
    await page.evaluate(() => {
      const b = document.querySelector('#idBtn');
      for(let i = 0; i < 5; i++) b.click();
    });
    await page.waitForTimeout(300);
    await expect(page.locator('#admHost')).toBeHidden();
  });

  test('администратор из списка панель открывает', async ({page}) => {
    // ?admin=1 открывает панель сразу на старте, до ритуала запуска
    await open(page, {tg: 777, config:{admins:[777]}, query: '&admin=1'});
    await expect(page.locator('#admHost')).toBeVisible();
    await expect(page.locator('#admSheet')).toContainText('Туман');
    await expect(page.locator('#qaBtn')).toBeVisible();
  });

  test('туман правится из панели на лету', async ({page}) => {
    await open(page);
    await boot(page);
    expect(await page.evaluate(() => window.__RZ.beta())).toEqual([0,1,3,4]);

    await page.locator('#qaBtn').click();
    await page.locator('[data-adm="fog"][data-i="2"]').click();        // открыли КАПСУЛУ
    expect(await page.evaluate(() => window.__RZ.beta())).toContain(2);
    expect(await page.evaluate(() => window.__RZ.node(2).st)).not.toBe(-1);
  });
});
