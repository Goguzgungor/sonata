// @ts-check
const { readFileSync, existsSync } = require('node:fs');
if (existsSync('server/.env.test')) for (const l of readFileSync('server/.env.test', 'utf8').split('\n')) { const m = /^(\w+)=(.*)$/.exec(l.trim()); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; }
const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  use: { baseURL: process.env.SITE_URL || 'http://localhost:3000', trace: 'retain-on-failure' },
  reporter: [['list']]
});
