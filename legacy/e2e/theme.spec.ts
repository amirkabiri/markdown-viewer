import { expect, test } from '@playwright/test';

test('theme toggle flips data-theme and persists across reload', async ({ page }) => {
  await page.goto('/');

  // Wait for boot to apply the stored/default theme before reading it.
  await expect(page.locator('#theme-btn')).toBeAttached();
  const initial = await page.getAttribute('html', 'data-theme');
  expect(['light', 'dark']).toContain(initial);

  await page.locator('#theme-btn').click();

  const flipped = initial === 'dark' ? 'light' : 'dark';
  await expect(page.locator('html')).toHaveAttribute('data-theme', flipped);

  // The choice is stored in localStorage (mv:theme) and re-applied on boot.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', flipped);
});
