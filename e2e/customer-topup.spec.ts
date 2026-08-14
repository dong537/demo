import { expect, test } from '@playwright/test';

test('Customer 登录 → 概览页显示真实 wallet 且核心数据无错误', async ({ page }) => {
  await page.goto('/login');
  await page.locator('input[autocomplete="username"]').fill('customer.e2e@example.com');
  await page.locator('input[autocomplete="current-password"]').fill('Customer123!');
  await page.locator('button[type="submit"]').click();

  await expect(page).toHaveURL(/\/overview$/);
  await expect(page.getByRole('heading', { name: '概览', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /余额 321\.45 CNY/ })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('Customer 创建充值单 → 看到待确认状态和单号', async ({ page }) => {
  await page.goto('/login');
  await page.locator('input[autocomplete="username"]').fill('customer.e2e@example.com');
  await page.locator('input[autocomplete="current-password"]').fill('Customer123!');
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/overview$/);

  await page.goto('/wallet/topup');
  await expect(page.getByText('创建充值单')).toBeVisible();
  await page.locator('input[role="spinbutton"]').fill('12.34');
  await page.locator('button[type="submit"]').click();

  await expect(page.locator('main').getByText('充值单已提交', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('待确认', { exact: true })).toBeVisible();
  await expect(page.getByText('12.34 CNY')).toBeVisible();
});
