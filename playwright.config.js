const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests',
  timeout: 90000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:8123',
    browserName: 'chromium',
    launchOptions: { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] },
  },
  webServer: {
    command: 'python3 scripts/serve.py --port 8123',
    url: 'http://127.0.0.1:8123',
    reuseExistingServer: false,
  },
});
