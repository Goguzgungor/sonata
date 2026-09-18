import { test, expect } from '@playwright/test';

const ID = process.env.E2E_CONTRACT_ID || 'CADY5JYDD7VE7M42HLGJILZAYRPJXPA7C7AOOJOLA44ECZDOA4NVULTP';
const G = process.env.E2E_SOURCE || 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

test('register → workspace → simulate → build → mcp → docs → public page', async ({ page }) => {
  await page.goto(`/register?id=${ID}`);
  await page.getByRole('button', { name: 'Generate' }).click();
  // This fixture is already registered with an unchanged WASM hash, so the
  // pipeline short-circuits: Fetch/Parse/Generate all read "unchanged · Done",
  // and "Index on-chain history" reads "Skipped". Either way the workspace
  // button appears once the pipeline settles.
  await expect(page.getByRole('button', { name: 'Open contract workspace' })).toBeVisible({ timeout: 90_000 });
  await page.getByRole('button', { name: 'Open contract workspace' }).click();

  await expect(page).toHaveURL(new RegExp(`/c/${ID}/overview`));
  await expect(page.getByText('Functions', { exact: false }).first()).toBeVisible();

  // Tabs render as role="tab" (confirmed via DOM inspection: `<div role="tab">`
  // inside a `tablist`), so a role-based locator is used throughout.
  await page.getByRole('tab', { name: /Functions/ }).click();

  // Function names in the Functions table render as `<button class="crumb">`,
  // so a plain role=button locator (with exact match to avoid substring
  // collisions such as "add" vs. a future "address" function) selects them.
  await page.getByRole('button', { name: 'add', exact: true }).click();
  // S.Field renders a real `<label for=...>` bound to the input's id, so
  // getByLabel resolves correctly (verified in the DOM: `<label for="sn-field-a">a</label>`).
  // Single-letter labels need `exact: true`: getByLabel's default substring
  // match otherwise also matches the primary nav's `aria-label="Primary"`
  // (which contains the letter "a"), causing a strict-mode violation.
  await page.getByLabel('a', { exact: true }).fill('5');
  await page.getByLabel('b', { exact: true }).fill('7');
  await page.getByRole('button', { name: 'Simulate' }).click();
  await expect(page.getByText('"12"')).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'ping', exact: true }).click();
  await page.getByLabel('who', { exact: true }).fill(G);
  await page.getByLabel('n', { exact: true }).fill('1');
  await page.getByLabel('source', { exact: true }).fill(G);
  // The kit's Segmented control renders actual `role="radio"` inputs inside a
  // `radiogroup` (confirmed in the DOM), so no `.or()` fallback is needed.
  await page.getByRole('radio', { name: 'Build transaction' }).click();
  await page.getByRole('button', { name: 'Build unsigned XDR' }).click();
  // The submit button's own label ("Build unsigned XDR") stays on screen and
  // contains "Unsigned XDR" as a substring, so exact match is required to
  // land on just the result section's "Unsigned XDR" heading.
  await expect(page.getByText('Unsigned XDR', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/^AAAA/)).toBeVisible();

  await page.getByRole('tab', { name: /MCP/ }).click();
  // Same Segmented-as-radiogroup pattern as the call/build mode above.
  await page.getByRole('radio', { name: 'Read + write' }).click();
  // The fixture has 15 functions (33 = 15 call + 15 build + submit_transaction
  // + search_functions + get_docs); read-only is 17 (15 call + 2 docs tools).
  // "enabled" also appears in an unrelated helper sentence above the table, so
  // the count label itself ("Tools · 33 enabled") is matched exactly to avoid
  // a strict-mode violation from multiple matches.
  await expect(page.getByText('Tools · 33 enabled')).toBeVisible({ timeout: 15_000 });

  await page.getByRole('tab', { name: /Docs/ }).click();
  await expect(page.locator('pre')).toContainText('# ', { timeout: 15_000 });

  await page.goto(`/explorer/${ID}`);
  await expect(page.getByText(`/c/${ID}/mcp`)).toBeVisible();
  await expect(page.getByText('Functions · 15')).toBeVisible();
});
