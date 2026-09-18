import { test, expect } from '@playwright/test';
import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';

const ID = process.env.E2E_CONTRACT_ID || 'CADY5JYDD7VE7M42HLGJILZAYRPJXPA7C7AOOJOLA44ECZDOA4NVULTP';
const API = process.env.E2E_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
const SECRET = process.env.E2E_SECRET_KEY || '';
const PASSPHRASES = { testnet: 'Test SDF Network ; September 2015', mainnet: 'Public Global Stellar Network ; September 2015' };

test.skip(!SECRET, 'needs E2E_SECRET_KEY (server/.env.test) to sign the wallet challenge');

/** The real challenge flow, signed here instead of by a wallet extension. */
async function session(request: any) {
  const kp = Keypair.fromSecret(SECRET);
  const ch = await (await request.post(`${API}/auth/challenge`, { data: { address: kp.publicKey(), network: 'testnet' } })).json();
  const tx = TransactionBuilder.fromXDR(ch.transaction, PASSPHRASES.testnet); tx.sign(kp);
  const t = await (await request.post(`${API}/auth/token`, { data: { transaction: tx.toXDR(), network: 'testnet' } })).json();
  return { token: t.token as string, address: kp.publicKey(), expires_at: t.expires_at as string };
}

test.afterEach(async ({ request }) => {
  const s = await session(request);
  await request.patch(`${API}/c/${ID}`, { data: { mcp_scope: 'ro' }, headers: { authorization: `Bearer ${s.token}` } });
});

test('owner: register → workspace controls → rename → scope → simulate → build → docs → explorer → public page', async ({ page, request }) => {
  const s = await session(request);
  await page.addInitScript((sess) => localStorage.setItem('sonata.session', JSON.stringify(sess)), s);
  await page.goto(`/register?id=${ID}`);
  await page.getByRole('button', { name: 'Generate' }).click();
  await expect(page.getByRole('button', { name: 'Open contract workspace' })).toBeVisible({ timeout: 90_000 });
  await page.getByRole('button', { name: 'Open contract workspace' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${ID}/overview`));
  await expect(page.getByRole('button', { name: 'Rename' })).toBeVisible();

  const fnTab = page.getByRole('tab', { name: /Functions/ });
  const n = Number((await fnTab.locator('.sn-tabs__count').innerText()).trim());
  expect(n).toBeGreaterThan(0);
  await fnTab.click();
  await page.getByRole('button', { name: 'add', exact: true }).click();
  await page.getByLabel('a', { exact: true }).fill('5');
  await page.getByLabel('b', { exact: true }).fill('7');
  await page.getByRole('button', { name: 'Simulate' }).click();
  await expect(page.getByText('"12"')).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'ping', exact: true }).click();
  await page.getByRole('radio', { name: 'Build transaction' }).click();
  await expect(page.getByLabel('source', { exact: true })).toHaveValue(s.address);   // prefilled from the session
  await expect(page.getByRole('button', { name: 'Sign & submit' })).toBeVisible();     // not clicked: no wallet extension here
  await page.getByLabel('who', { exact: true }).fill(s.address);
  await page.getByLabel('n', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Build unsigned XDR' }).click();
  await expect(page.getByText('Unsigned XDR', { exact: true })).toBeVisible({ timeout: 30_000 });

  await page.getByRole('tab', { name: /MCP/ }).click();
  await page.getByRole('radio', { name: 'Read + write' }).click();
  await expect(page.getByText(`Tools · ${n * 2 + 3} enabled`)).toBeVisible({ timeout: 15_000 });

  await page.getByRole('tab', { name: /History/ }).click();
  await expect(page.getByText("History isn't live yet.")).toBeVisible();

  await page.goto('/explorer');
  await expect(page.getByText(ID)).toBeVisible({ timeout: 15_000 });
  await page.goto(`/explorer/${ID}`);
  await expect(page.getByText(`/c/${ID}/mcp`)).toBeVisible();
  await expect(page.getByText(`Functions · ${n}`)).toBeVisible();
});

test('anonymous: no owner controls, register asks for a wallet', async ({ page }) => {
  await page.goto(`/c/${ID}/overview`);
  await expect(page.getByText(/Owned by|Unclaimed/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Rename' })).toHaveCount(0);
  await page.goto(`/register?id=${ID}`);
  await expect(page.getByRole('button', { name: 'Connect wallet to register' })).toBeVisible();
  await page.goto('/flows');
  // Next's default not-found page renders both "404" and "This page could not be
  // found." as separate text nodes, so the regex needs .first() to avoid a
  // strict-mode violation (two elements would otherwise match).
  await expect(page.getByText(/404|could not be found/i).first()).toBeVisible();
});
