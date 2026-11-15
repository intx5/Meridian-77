import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  reporter: [['list'], ['json', { outputFile: '.browser-check/terrain-tests.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:4181',
    channel: 'chrome',
    headless: true,
    viewport: { width: 1600, height: 1000 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run preview -- --port 4181 --strictPort',
    url: 'http://127.0.0.1:4181',
    reuseExistingServer: false,
  },
})
