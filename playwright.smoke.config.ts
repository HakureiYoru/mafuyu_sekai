import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests', testMatch: 'first-batch.spec.ts', timeout: 60_000,
  expect: { timeout: 15_000 }, workers: 1, fullyParallel: false,
  outputDir: 'test-results/smoke',
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/smoke', open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:5185', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop-retina', use: { browserName: 'chromium', viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 } },
    { name: 'mobile-retina-chromium', use: { browserName: 'chromium', viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true } },
    { name: 'mobile-retina-webkit', use: { browserName: 'webkit', viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true } },
  ],
  webServer: { command: 'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 5185 --strictPort',
    url: 'http://127.0.0.1:5185', reuseExistingServer: false },
});
