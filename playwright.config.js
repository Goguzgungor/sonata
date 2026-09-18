// @ts-check
const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  use: { baseURL: process.env.SITE_URL || 'http://localhost:3000', trace: 'retain-on-failure' },
  reporter: [['list']]
});
