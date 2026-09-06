import { expect, test, type Page } from '@playwright/test'

/**
 * All three paths Suggestions can take, against a running deployment.
 *
 * `suggest.spec.ts` covers the refusal. These cover the two that produce
 * something, and they are separate tests rather than one loop so a failure
 * names the path that failed.
 *
 * Point at production with:
 *   E2E_BASE_URL=https://rfi-vault.vercel.app npx playwright test e2e/suggest-modes.spec.ts
 */

const HUB = { email: 'hub@rfivault.demo', password: 'RfiVault!Demo2026' }

async function signIn(page: Page) {
  await page.goto('/sign-in')
  await page.getByLabel(/email/i).fill(HUB.email)
  await page.getByLabel(/password/i).fill(HUB.password)
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL(/\/(search|suggest)/, { timeout: 30_000 })
}

async function upload(page: Page, pdf: string): Promise<string> {
  await page.goto('/suggest')
  await page.locator('input[type="file"]').setInputFiles(pdf)
  await expect(page.getByText(/Uploaded\. Suggest responses below\./i)).toBeVisible({
    timeout: 60_000,
  })

  // The hidden file input carries the label's text, so match the button's exact
  // name; it stays disabled until the upload to Storage finishes.
  const submit = page.getByRole('button', { name: 'Suggest responses', exact: true })
  await expect(submit).toBeEnabled({ timeout: 60_000 })
  await submit.click()

  // Whichever path ran, the first heading in the result is the signal it arrived:
  // h2 for a review verdict or a refusal, h3 for the first option card — the
  // options path carries no h2 of its own.
  await expect(page.locator('main :is(h2, h3)').first()).toBeVisible({ timeout: 210_000 })
  return page.locator('main').innerText()
}

test('a consideration with no response gets options', async ({ page }) => {
  test.setTimeout(300_000)
  await signIn(page)
  const body = await upload(page, 'fixtures/rfi-consideration-only.pdf')

  console.log('\n───── consideration only ─────\n' + body.slice(0, 1400) + '\n')

  expect(body).toContain('Option 1')
  expect(body).toContain('Precedent these were built from')
  expect(body).not.toContain('reviewed rather than answered')
  // At least one of the three strategies came back.
  expect(body).toMatch(/Supply the document|Justify what was already filed|Acknowledge and commit/)
})

test('a response that matches precedent is called adequate', async ({ page }) => {
  test.setTimeout(300_000)
  await signIn(page)
  const body = await upload(page, 'fixtures/rfi-answered-well.pdf')

  console.log('\n───── answered well ─────\n' + body.slice(0, 1400) + '\n')

  expect(body).toContain('reviewed rather than answered')
  expect(body).toContain('This response looks adequate')
})

test('a response that supplies nothing gets specific changes', async ({ page }) => {
  test.setTimeout(300_000)
  await signIn(page)
  const body = await upload(page, 'fixtures/rfi-answered-badly.pdf')

  console.log('\n───── answered badly ─────\n' + body.slice(0, 2000) + '\n')

  expect(body).toContain('reviewed rather than answered')
  expect(body).toMatch(/to change before sending/)
  // Nothing offered for pasting may carry placeholder text (ADR-037).
  expect(body).not.toMatch(/x{4,}/i)
  expect(body).not.toMatch(/\[insert/i)
})
