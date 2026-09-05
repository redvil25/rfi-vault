import { expect, test, type Page } from '@playwright/test'

/**
 * Suggestions, driven against a running deployment.
 *
 * Unlike the Clinical Report Check, this path needs embeddings: its safety
 * property is a cosine-similarity gate, and the gate cannot be computed without
 * them. That makes it the test that actually exercises the ONNX runtime on the
 * host, which is where three separate production failures lived.
 */

const HUB = { email: 'hub@rfivault.demo', password: 'RfiVault!Demo2026' }
const REQUEST_PDF = 'fixtures/rfi-example-ctis.pdf'

async function signIn(page: Page) {
  await page.goto('/sign-in')
  await page.getByLabel(/email/i).fill(HUB.email)
  await page.getByLabel(/password/i).fill(HUB.password)
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL(/\/(search|suggest)/, { timeout: 30_000 })
}

test('suggests responses to an uploaded request', async ({ page }) => {
  test.setTimeout(240_000)

  await signIn(page)
  await page.goto('/suggest')
  await page.locator('input[type="file"]').setInputFiles(REQUEST_PDF)
  await expect(page.getByText(/Uploaded\. Suggest responses below\./i)).toBeVisible({
    timeout: 60_000,
  })

  // The hidden file input carries the label text too, so match the button's
  // exact name, and wait for it to be enabled: it stays disabled until the
  // upload to Storage has finished.
  const submit = page.getByRole('button', { name: 'Suggest responses', exact: true })
  await expect(submit).toBeEnabled({ timeout: 60_000 })
  await submit.click()
  await expect(page.locator('h2').first()).toBeVisible({ timeout: 210_000 })

  const body = await page.locator('main').innerText()
  console.log('\n───────── suggestions ─────────\n')
  console.log(body.slice(body.indexOf('page') > 0 ? body.indexOf('page') : 0, 2600))
  console.log('\n───────────────────────────────\n')

  // The failure that hid everything else: embeddings unavailable on the host.
  expect(body).not.toContain('Embedding this consideration failed')
})
