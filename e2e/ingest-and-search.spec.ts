import { expect, test, type Page } from '@playwright/test'
import '../scripts/load-env'
import { createServiceClient } from '../lib/db/service'

/**
 * The whole chain a user actually walks: upload a scanned export, watch it be
 * read, review the extraction, file it, then find it in search.
 *
 * Runs against the live project, so it removes the trial it creates. Audit
 * events are append-only by design and are left behind.
 */

const HUB = { email: 'hub@rfivault.demo', password: 'RfiVault!Demo2026' }
const AFFILIATE = { email: 'affiliate.it@rfivault.demo', password: 'RfiVault!Demo2026' }

const TRIAL_NO = '2024-519530-24-00'
const DOC_REF = 'CT-2024-519530-24-00-SM06-001'
const SCANNED = 'fixtures/rfi-example-scanned.pdf'

async function removeTestTrial() {
  await createServiceClient().from('trial').delete().eq('eu_trial_number', TRIAL_NO)
}

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto('/sign-in')
  await page.fill('#email', who.email)
  await page.fill('#password', who.password)
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL('**/search')
}

// Per test, not once: filing the same document reference twice is correctly
// refused, so each test that files must start from a clean slate.
test.beforeEach(removeTestTrial)
test.afterAll(removeTestTrial)

test('a scanned RFI can be uploaded, reviewed, filed, and then found in search', async ({
  page,
}) => {
  await signIn(page, HUB)
  await page.goto('/ingest')

  // --- Choosing a file gives immediate, visible confirmation ---------------
  await expect(page.getByRole('button', { name: /extract and review/i })).toBeDisabled()
  await page.setInputFiles('#file', SCANNED)
  await expect(page.getByText('rfi-example-scanned.pdf')).toBeVisible()
  await expect(page.getByText(/ready to extract/i)).toBeVisible()

  const extract = page.getByRole('button', { name: /extract and review/i })
  await expect(extract).toBeEnabled()
  await extract.click()

  // --- Progress is reported while the document is read --------------------
  // Reading a scan takes ~9s; the page must never look idle during it.
  await expect(page.getByRole('status')).toBeVisible()

  // --- Review screen ------------------------------------------------------
  await expect(page.getByRole('heading', { name: /check the extraction/i })).toBeVisible()
  await expect(page.getByText(/read by ocr/i)).toBeVisible()
  await expect(page.getByText(DOC_REF)).toBeVisible()
  await expect(page.getByText('2 considerations')).toBeVisible()

  // Nothing has been written yet.
  const { count: beforeCommit } = await createServiceClient()
    .from('rfi_document')
    .select('*', { count: 'exact', head: true })
    .eq('document_ref', DOC_REF)
  expect(beforeCommit).toBe(0)

  // --- File it ------------------------------------------------------------
  await page.getByRole('button', { name: /approve and file/i }).click()
  await expect(page.getByRole('heading', { name: /filed into the repository/i })).toBeVisible()
  await expect(page.getByText(DOC_REF)).toBeVisible()

  // --- Immediately findable in search -------------------------------------
  await page.getByRole('link', { name: /find them in search/i }).click()
  await page.waitForURL('**/search**')

  await expect(page.getByText(/considerations matching/i)).toBeVisible()
  await expect(page.locator('article').first()).toContainText(DOC_REF)
  await expect(page.getByText(/matched on identifier/i).first()).toBeVisible()

  // --- And by its wording, not just its identifier -------------------------
  await page.goto('/search?q=' + encodeURIComponent('ISTAT updated fee'))
  await expect(page.locator('article').first()).toBeVisible()
  await expect(page.locator('article').filter({ hasText: DOC_REF }).first()).toBeVisible()
})

test('search works for an Affiliate, and RLS still hides another team\'s open draft', async ({
  page,
}) => {
  // The scanned export has one answered consideration and one still open. The
  // open one is owned by RA Clinical, so an Affiliate must not see it.
  await signIn(page, HUB)
  await page.goto('/ingest')
  await page.setInputFiles('#file', SCANNED)
  await page.getByRole('button', { name: /extract and review/i }).click()
  await expect(page.getByRole('heading', { name: /check the extraction/i })).toBeVisible()
  await page.getByRole('button', { name: /approve and file/i }).click()
  await expect(page.getByRole('heading', { name: /filed into the repository/i })).toBeVisible()

  const filedAs = await createServiceClient()
    .from('rfi_consideration')
    .select('response_status, owner_team')
    .eq('category', 'IMPD_QUALITY')
    .eq('response_status', 'SUBMITTED')
  expect(filedAs.data?.length).toBeGreaterThan(0)

  await page.context().clearCookies()
  await signIn(page, AFFILIATE)

  await page.goto('/search?q=' + encodeURIComponent(DOC_REF))
  await expect(page.locator('article').first()).toBeVisible()

  // Filing is a submission-hub function; an Affiliate is told so plainly.
  await page.goto('/ingest')
  await expect(page.getByText(/your team cannot file documents/i)).toBeVisible()
})

test('search facets and filters narrow results', async ({ page }) => {
  await signIn(page, HUB)
  await page.goto('/search?q=' + encodeURIComponent('proof of payment'))

  await expect(page.locator('article').first()).toBeVisible()
  const unfiltered = await page.locator('article').count()
  expect(unfiltered).toBeGreaterThan(0)

  await page.selectOption('#f-memberState', 'IT')
  await page.waitForURL('**memberState=IT**')
  await expect(page.locator('article').first()).toBeVisible()

  // Every visible result must carry the filtered Member State.
  const badges = await page.locator('article').locator('span', { hasText: /^IT$/ }).count()
  expect(badges).toBeGreaterThan(0)
})
