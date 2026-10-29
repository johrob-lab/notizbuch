import { test, expect } from '@playwright/test';

test('app shell loads and registers a service worker', async ({ page }) => {
  await page.goto('/notizbuch/');
  await expect(page).toHaveTitle('Notizbuch');
  await expect(page.locator('#app')).toBeVisible();
  await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()))).toBe(true);
});
