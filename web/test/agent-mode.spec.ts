import { test, expect, type Locator, type Page } from '@playwright/test';

async function isVisible(locator: Locator): Promise<boolean> {
  try {
    return await locator.isVisible();
  } catch {
    return false;
  }
}

async function openAgentMode(page: Page): Promise<'agent' | 'dashboard-disabled'> {
  await page.goto('/projects');
  await expect(page.getByTestId('mode-toggle')).toBeVisible();

  const agentToggle = page.getByTestId('mode-toggle-agent');
  await expect(agentToggle).toBeVisible();

  if (await agentToggle.isDisabled()) {
    await expect(page).toHaveURL(/\/projects/);
    return 'dashboard-disabled';
  }

  await agentToggle.click();
  await expect(page).toHaveURL(/\/agent/);
  return 'agent';
}

test.describe.configure({ mode: 'serial' });

test.describe('Agent Mode', () => {
  test('mode toggle is visible on dashboard', async ({ page }) => {
    await page.goto('/projects');
    await expect(page.getByTestId('mode-toggle')).toBeVisible();
    await expect(page.getByTestId('mode-toggle-dashboard')).toBeVisible();
    await expect(page.getByTestId('mode-toggle-agent')).toBeVisible();
  });

  test('mode toggle switches to agent when enabled', async ({ page }) => {
    const state = await openAgentMode(page);
    if (state === 'dashboard-disabled') {
      await expect(page.getByTestId('mode-toggle-agent')).toBeDisabled();
      return;
    }

    await expect(page.getByTestId('agent-page')).toBeVisible();
  });

  test('mode toggle switches back to dashboard from agent route', async ({ page }) => {
    await page.goto('/agent');
    await expect(page.getByTestId('mode-toggle-dashboard')).toBeVisible();
    await page.getByTestId('mode-toggle-dashboard').click();
    await expect(page).toHaveURL(/\/projects/);
  });

  test('agent page renders gate or chat layout', async ({ page }) => {
    await page.goto('/agent');
    await expect(page.getByTestId('agent-page')).toBeVisible();

    const llmGateVisible = await isVisible(page.getByTestId('llm-not-configured'));
    const emptyStateVisible = await isVisible(page.getByTestId('empty-state'));
    const chatInputVisible = await isVisible(page.getByTestId('chat-input'));

    expect(llmGateVisible || emptyStateVisible || chatInputVisible).toBeTruthy();
  });

  test('llm not configured gate appears when agent toggle is disabled', async ({ page }) => {
    await page.goto('/projects');
    const agentToggle = page.getByTestId('mode-toggle-agent');
    await expect(agentToggle).toBeVisible();

    if (await agentToggle.isDisabled()) {
      await page.goto('/agent');
      await expect(page.getByTestId('llm-not-configured')).toBeVisible();
    } else {
      await expect(agentToggle).toBeEnabled();
    }
  });

  test('empty state shows suggestion chips when chat is available', async ({ page }) => {
    await page.goto('/agent');

    const gateVisible = await isVisible(page.getByTestId('llm-not-configured'));
    if (gateVisible) {
      await expect(page.getByTestId('llm-not-configured')).toBeVisible();
      return;
    }

    await expect(page.getByTestId('empty-state')).toBeVisible();
    await expect(page.getByTestId('suggestion-chip').first()).toBeVisible();
  });

  test('chat input accepts text and send button enablement changes', async ({ page }) => {
    await page.goto('/agent');

    const input = page.getByTestId('chat-input');
    if (!(await isVisible(input))) {
      await expect(page.getByTestId('llm-not-configured')).toBeVisible();
      return;
    }

    const sendButton = page.getByTestId('chat-send');
    await expect(sendButton).toBeDisabled();

    await input.fill('Hello agent');
    await expect(input).toHaveValue('Hello agent');
    await expect(sendButton).toBeEnabled();

    await input.fill('');
    await expect(input).toHaveValue('');
    await expect(sendButton).toBeDisabled();
  });

  test('new chat button exists in sidebar while in agent mode route', async ({ page }) => {
    await page.goto('/agent');
    await expect(page.getByTestId('session-list')).toBeVisible();
    await expect(page.getByTestId('new-chat-button')).toBeVisible();
  });

  test('full navigation flow dashboard to agent and back', async ({ page }) => {
    await page.goto('/projects');
    await expect(page.getByTestId('mode-toggle')).toBeVisible();

    const agentToggle = page.getByTestId('mode-toggle-agent');
    if (await agentToggle.isDisabled()) {
      await agentToggle.click();
      await expect(page).toHaveURL(/\/projects/);
      await expect(agentToggle).toBeDisabled();
      return;
    }

    await agentToggle.click();
    await expect(page).toHaveURL(/\/agent/);
    await expect(page.getByTestId('agent-page')).toBeVisible();

    await page.getByTestId('mode-toggle-dashboard').click();
    await expect(page).toHaveURL(/\/projects/);
    await expect(page.getByTestId('mode-toggle')).toBeVisible();
  });
});
