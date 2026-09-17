import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testIgnore: 'mobile.spec.ts',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:5181', viewport: { width: 1280, height: 720 }, channel: 'chromium', launchOptions: { args: process.platform === 'win32' ? ['--use-angle=d3d11'] : [] }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 5181 --strictPort', url: 'http://127.0.0.1:5181', reuseExistingServer: false },
});
