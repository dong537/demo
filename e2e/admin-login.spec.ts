import { expect, test } from '@playwright/test';

test('Admin 可以登录后看到用户列表', async ({ page }) => {
  await page.goto('/admin/login');
  await page.locator('input[autocomplete="username"]').fill('admin.e2e@example.com');
  await page.locator('input[autocomplete="current-password"]').fill('Admin123!');
  await page.locator('button[type="submit"]').click();

  await expect(page).toHaveURL(/\/admin\/users$/);
  await expect(page.getByText('用户列表')).toBeVisible();
  await expect(page.getByText('customer.e2e@example.com')).toBeVisible();
});

test('未登录直接访问 /admin/users → redirect 到 /admin/login', async ({ page }) => {
  await page.goto('/admin/users');

  await expect(page).toHaveURL(/\/admin\/login$/);
  await expect(page.getByRole('heading', { name: '管理员登录', exact: true })).toBeVisible();
});
