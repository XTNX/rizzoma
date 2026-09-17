import { defineConfig } from '@playwright/test';

/* Телефонный вьюпорт: приложение живёт в Telegram, десктоп — частный случай.
   Браузер один (chromium) — в CI не за чем тянуть три движка ради канвы. */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.mjs',
  timeout: 60_000,
  fullyParallel: true,
  /* Сцена постоянно считает канву: четыре параллельных браузера отнимают
     кадры друг у друга, жесты начинают промахиваться мимо таймингов.
     Два воркера держат прогон быстрым и стабильным, в CI — один. */
  workers: process.env.CI ? 1 : 2,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:4321',
    browserName: 'chromium',
    viewport: {width: 390, height: 844},
    deviceScaleFactor: 2,
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'node tests/serve.mjs',
    port: 4321,
    reuseExistingServer: !process.env.CI
  }
});
