import { expect, test, type Page } from '@playwright/test'

/**
 * The Clinical Report Check, driven against a running deployment.
 *
 * This exists because three production failures in a row were invisible to the
 * unit tests, the typecheck, the build and the live verification scripts — all
 * of which run in a Node process on a laptop. A missing native library, a
 * polyfill the host lacked, and a blank environment variable are properties of
 * the *deployment*, and only a request to it can tell you about them.
 *
 * Point it at production with:
 *   E2E_BASE_URL=https://rfi-vault.vercel.app npx playwright test e2e/report-check.spec.ts
 */

const HUB = { email: 'hub@rfivault.demo', password: 'RfiVault!Demo2026' }

/** Deliberately imperfect; every flaw in it is one the check should find. */
const REPORT_PDF = 'fixtures/clinical-report-example.pdf'

async function signIn(page: Page) {
  await page.goto('/sign-in')
  await page.getByLabel(/email/i).fill(HUB.email)
  await page.getByLabel(/password/i).fill(HUB.password)
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL(/\/(search|report-check)/, { timeout: 30_000 })
}

test('checks an uploaded clinical report end to end', async ({ page }) => {
  test.setTimeout(180_000)

  const failures: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') failures.push(m.text())
  })

  await signIn(page)
  await page.goto('/report-check')
  await expect(page.getByRole('heading', { name: 'Clinical Report Check' })).toBeVisible()

  // Upload. The input is visually hidden behind its label, so target it directly.
  await page.locator('input[type="file"]').setInputFiles(REPORT_PDF)
  await expect(page.getByText(/Uploaded\. Run the check below\./i)).toBeVisible({
    timeout: 60_000,
  })

  await page.getByRole('button', { name: /check the report/i }).click()

  // Either a result or a stated reason — never a silent nothing.
  const headline = page.locator('h2').first()
  await expect(headline).toBeVisible({ timeout: 150_000 })

  const body = await page.locator('main').innerText()
  console.log('\n───────── what the deployment returned ─────────\n')
  console.log(body.slice(0, 3000))
  console.log('\n───────────────────────────────────────────────\n')
  if (failures.length > 0) console.log('console errors:', failures.slice(0, 5))

  // The document names four taxonomy sections, so the split must have worked.
  expect(body).not.toContain('No heading in that document maps onto an application section')
  // And the PDF must have been read at all — the failure that hid the others.
  expect(body).not.toContain('The uploaded file could not be read')
})
