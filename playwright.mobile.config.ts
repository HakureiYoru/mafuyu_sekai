import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests', testMatch: 'mobile.spec.ts', timeout: 45_000,
  expect: { timeout: 10_000 }, fullyParallel: false, workers: 1,
  outputDir: 'test-results/mobile',
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/mobile', open: 'never' }], ['json', { outputFile: 'test-results/mobile/report.json' }]],
  use: { baseURL: 'http://127.0.0.1:5184', viewport: { width: 844, height: 390 },
    hasTouch: true, isMobile: true, deviceScaleFactor: 1, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'mobile-chromium', use: { browserName: 'chromium', channel: 'chromium', launchOptions: { args: process.platform === 'win32' ? ['--use-angle=d3d11'] : [] } } },
    { name: 'mobile-webkit', use: { browserName: 'webkit' } },
  ],
  webServer: { command: 'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 5184 --strictPort',
    url: 'http://127.0.0.1:5184', reuseExistingServer: false },
});
