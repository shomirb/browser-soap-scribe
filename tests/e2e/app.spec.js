import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const shots = 'docs/screenshots';
mkdirSync(shots, { recursive: true });

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    console.log('PAGEERROR', error.message);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('BROWSER', msg.text());
  });
});

test('sample transcripts, checklist, and privacy shell', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#app-ready')).toHaveAttribute('data-ready', 'yes');
  await expect(page.locator('#download-notice')).toContainText('512 MB');
  await expect(page.locator('#runtime-note')).toContainText('Recommended path');
  await expect(page.locator('#try-sample')).toBeVisible();
  await expect(page.locator('#disclaimer')).toContainText('Not medical advice');
  await expect(page.locator('#disclaimer')).toContainText('not for clinical use');
  await expect(page.locator('#sample-select option')).toHaveCount(6);
  await expect(page.locator('#privacy-pill')).toHaveAttribute('data-clinical', '0');
  await expect(page.locator('#line-list .line').first()).toContainText('SYNTHETIC SAMPLE');

  await page.selectOption('#sample-select', 'syn-2203');
  await expect(page.locator('#missing-flags')).toContainText('Allergies missing');
  await expect(page.locator('#missing-flags')).toContainText('Medications missing');
  await expect(page.locator('#missing-flags')).toContainText('Vitals missing');
  await page.screenshot({ path: `${shots}/missing-flags.png` });

  await page.selectOption('#sample-select', 'syn-2201');
  await expect(page.locator('#missing-flags')).toContainText('Allergies mentioned');
  await expect(page.locator('#missing-flags')).toContainText('Medications mentioned');
  await expect(page.locator('#missing-flags')).toContainText('Vitals mentioned');

  await page.fill('#transcript', 'Patient: I have a penicillin allergy and no other history.');
  await expect(page.locator('#missing-flags')).toContainText('Allergies mentioned');
  await expect(page.locator('#missing-flags')).toContainText('Medications missing');
  await page.fill('#transcript', '');
  await expect(page.locator('#draft-button')).toBeDisabled();
  await expect(page.locator('#export-md')).toBeDisabled();

  await page.selectOption('#runtime-select', 'wasm');
  await expect(page.locator('#model-select')).toContainText('Qwen2.5 0.5B');
  await page.locator('#privacy-pill').click();
  await expect(page.locator('#privacy-panel')).toContainText('DevTools');
  await expect(page.locator('#privacy-panel')).toContainText('Hugging Face');
  await page.locator('#privacy-close').click();
  await expect(page.locator('#privacy-panel')).toBeHidden();
});

test('drafts a SOAP note with the in-browser WASM model', async ({ page }) => {
  test.setTimeout(18 * 60 * 1000);
  await page.goto('/?runtime=wasm&sample=syn-2201&maxTokens=110');
  await expect(page.locator('#app-ready')).toHaveAttribute('data-ready', 'yes');
  await expect(page.locator('#runtime-select')).toHaveValue('wasm');
  await page.screenshot({ path: `${shots}/ready-to-draft.png` });

  await page.locator('#try-sample').click();
  await expect(page.locator('#model-status')).toContainText(/download|loading|draft|cpu|wasm|qwen/i, {
    timeout: 30_000,
  });
  const ready = page
    .waitForFunction(() => document.querySelector('#note')?.dataset.state === 'ready', null, {
      timeout: 17 * 60 * 1000,
    })
    .then(() => 'ready')
    .catch(() => 'ready-error');
  const failed = page
    .waitForFunction(() => {
      const error = document.querySelector('#model-error');
      return Boolean(error && !error.hidden && error.textContent.trim());
    }, null, { timeout: 17 * 60 * 1000 })
    .then(() => 'failed')
    .catch(() => 'failed-error');
  const outcome = await Promise.race([ready, failed]);
  if (outcome === 'failed') {
    throw new Error(await page.locator('#model-error').innerText());
  }

  for (const section of ['subjective', 'objective', 'assessment', 'plan']) {
    await expect(page.locator(`#section-${section}`)).toBeVisible();
  }
  const noteText = await page.locator('#note textarea').evaluateAll((nodes) => nodes.map((node) => node.value).join('\n'));
  expect(noteText).toMatch(/throat/i);
  expect(noteText).not.toMatch(/penicillin allergy|End with it|myocardial|intensive care/i);
  await expect(page.locator('#section-summary textarea')).toHaveValue(/throat|cough|rest|fluid|ibuprofen|penicillin/i);
  await expect(page.locator('#markdown-preview')).not.toContainText('function ');
  await expect(page.locator('#picker-note')).not.toHaveText('');
  await expect(page.locator('#markdown-preview')).toContainText('Not medical advice and not for clinical use');
  await expect(page.locator('#markdown-preview')).toContainText('## Subjective');
  await expect(page.locator('#privacy-pill')).toHaveAttribute('data-clinical', '0');
  await expect(page.locator('.net-blocked')).toHaveCount(0);

  const leaked = await page.locator('#privacy-log').textContent();
  expect(leaked.toLowerCase()).not.toContain('ibuprofen 200 mg this morning');

  const cite = page.locator('#section-subjective .cite').first();
  await cite.click();
  await expect(page.locator('.line.active')).toBeVisible();
  await page.screenshot({ path: `${shots}/soap-draft.png`, fullPage: true });

  await page.locator('#section-subjective textarea').first().fill('Edited subjective statement for the demo.');
  await expect(page.locator('#markdown-preview')).toContainText('Edited in the browser');

  await page.locator('#privacy-pill').click();
  await expect(page.locator('#draft-requests')).toContainText('Blocked or unexpected: 0');
  await page.screenshot({ path: `${shots}/privacy-log.png` });
});
