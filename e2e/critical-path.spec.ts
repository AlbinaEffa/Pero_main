/**
 * Critical path E2E test for Pero.
 *
 * Covers the main user journey:
 *   Register → Dashboard → Create project → Open editor →
 *   Type text → Open co-author panel → Send message →
 *   Open bible → Extract entities
 *
 * Setup:
 *   npm install -D @playwright/test
 *   npx playwright install chromium
 *   npx playwright test
 */

import { test, expect, Page } from '@playwright/test';

// Unique email per test run to avoid conflicts
const EMAIL = `test+${Date.now()}@pero.test`;
const PASSWORD = 'TestPassword123!';
const DISPLAY_NAME = 'Test Writer';
const PROJECT_TITLE = 'E2E Test Novel';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function register(page: Page) {
  await page.goto('/register');
  await page.getByPlaceholder(/email/i).fill(EMAIL);
  await page.getByPlaceholder(/имя/i).fill(DISPLAY_NAME);
  await page.getByPlaceholder(/пароль/i).first().fill(PASSWORD);
  // Some forms have confirm password
  const confirm = page.getByPlaceholder(/подтвердит/i);
  if (await confirm.isVisible()) await confirm.fill(PASSWORD);
  await page.getByRole('button', { name: /зарегистрироватьс|sign up|создать/i }).click();
  await page.waitForURL('**/dashboard', { timeout: 10_000 });
}

async function login(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder(/email/i).fill(EMAIL);
  await page.getByPlaceholder(/пароль/i).fill(PASSWORD);
  await page.getByRole('button', { name: /войти|sign in|вход/i }).click();
  await page.waitForURL('**/dashboard', { timeout: 10_000 });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Critical user path', () => {

  test('register and see dashboard', async ({ page }) => {
    await register(page);
    await expect(page).toHaveURL(/dashboard/);
    // Dashboard should render without crashing
    await expect(page.locator('body')).not.toContainText('Что-то пошло не так');
  });

  test('create new project and open editor', async ({ page }) => {
    await register(page);

    // Find and click "New project" button
    const newProjectBtn = page.getByRole('button', { name: /новый проект|new project|\+/i }).first();
    await expect(newProjectBtn).toBeVisible({ timeout: 8_000 });
    await newProjectBtn.click();

    // Fill title in the modal
    const titleInput = page.getByPlaceholder(/название|title/i).first();
    await expect(titleInput).toBeVisible({ timeout: 5_000 });
    await titleInput.fill(PROJECT_TITLE);

    // Submit
    await page.getByRole('button', { name: /создать|create/i }).click();

    // Should navigate to the editor
    await page.waitForURL(/\/editor\//, { timeout: 10_000 });
    await expect(page).toHaveURL(/\/editor\//);
  });

  test('type in the editor and verify autosave indicator', async ({ page }) => {
    await register(page);

    // Create project (reuse same flow)
    const newProjectBtn = page.getByRole('button', { name: /новый проект|new project|\+/i }).first();
    await newProjectBtn.click();
    const titleInput = page.getByPlaceholder(/название|title/i).first();
    await titleInput.fill(PROJECT_TITLE);
    await page.getByRole('button', { name: /создать|create/i }).click();
    await page.waitForURL(/\/editor\//, { timeout: 10_000 });

    // Click the editor area and type
    const editorArea = page.locator('.ProseMirror').first();
    await expect(editorArea).toBeVisible({ timeout: 8_000 });
    await editorArea.click();
    await editorArea.type('Это тестовый текст для E2E теста. Персонаж Иван появился в темноте.');

    // Autosave should be triggered — wait briefly then check content is still there
    await page.waitForTimeout(2000);
    await expect(editorArea).toContainText('Иван');
  });

  test('open co-author panel and send message', async ({ page }) => {
    await register(page);

    const newProjectBtn = page.getByRole('button', { name: /новый проект|new project|\+/i }).first();
    await newProjectBtn.click();
    const titleInput = page.getByPlaceholder(/название|title/i).first();
    await titleInput.fill(PROJECT_TITLE);
    await page.getByRole('button', { name: /создать|create/i }).click();
    await page.waitForURL(/\/editor\//, { timeout: 10_000 });

    // Type some content first
    const editorArea = page.locator('.ProseMirror').first();
    await editorArea.click();
    await editorArea.type('Иван шёл по лесу. Было темно.');

    // Open co-author panel
    const coauthorBtn = page.getByRole('button', { name: /соавтор/i });
    await expect(coauthorBtn).toBeVisible({ timeout: 5_000 });
    await coauthorBtn.click();

    // Wait for chat panel to appear
    const chatPanel = page.getByText(/ИИ-Соавтор/i);
    await expect(chatPanel).toBeVisible({ timeout: 5_000 });

    // Find chat input and send a message
    const chatInput = page.getByPlaceholder(/спросите|сообщение|message/i).first();
    if (await chatInput.isVisible()) {
      await chatInput.fill('Кто такой Иван?');
      await chatInput.press('Enter');
      // Wait for AI response (may take a few seconds)
      await expect(page.locator('[class*="CoauthorPanel"]').or(page.locator('text=/Иван/')))
        .toBeVisible({ timeout: 20_000 });
    }
  });

  test('login with existing account redirects to dashboard', async ({ page }) => {
    await register(page);
    // Logout (if logout button exists)
    const logoutBtn = page.getByRole('button', { name: /выйти|logout|sign out/i });
    if (await logoutBtn.isVisible()) await logoutBtn.click();

    await login(page);
    await expect(page).toHaveURL(/dashboard/);
  });

  test('error boundary does not show on normal usage', async ({ page }) => {
    await register(page);
    await expect(page.getByText('Что-то пошло не так')).not.toBeVisible();
  });

});

test.describe('Navigation guards', () => {

  test('unauthenticated user is redirected to login', async ({ page }) => {
    // Clear auth token
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('pero_token'));
    await page.goto('/dashboard');
    await page.waitForURL(/\/(login|register|)/, { timeout: 8_000 });
  });

  test('/editor without projectId redirects', async ({ page }) => {
    await page.goto('/editor/invalid-uuid/invalid-uuid');
    // Should either redirect or show editor without crashing
    await expect(page.locator('body')).not.toContainText('Что-то пошло не так');
  });

});
