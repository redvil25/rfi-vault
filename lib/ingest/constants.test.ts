import { describe, expect, it } from 'vitest'
import { checkFileable } from './constants'
import { parseCtisRfi } from './parse-ctis'

const HEADER =
  '2024-519530-24-00 SUBSTANTIAL MODIFICATION ' +
  'CT-2024-519530-24-00-SM06-001 - Requests for information05/08/2026 12:53'

const BLOCK = [
  'Consideration number:',
  '1',
  'Application section parts',
  'Part I - Regulatory',
  'Consideration:',
  'The QP declaration is not signed.',
  'Sponsor response:',
  'A signed declaration is provided.',
].join('\n')

describe('checkFileable', () => {
  it('accepts a document with a header and at least one consideration', () => {
    const verdict = checkFileable(parseCtisRfi(`${HEADER}\n${BLOCK}`))

    expect(verdict.ok).toBe(true)
    if (verdict.ok) {
      expect(verdict.document.documentRef).toBe('CT-2024-519530-24-00-SM06-001')
      expect(verdict.document.euTrialNumber).toBe('2024-519530-24-00')
    }
  })

  /**
   * The exact shape that reached the review screen with a live "Approve and
   * file" button: every header field read, and nothing to file.
   */
  it('refuses a document whose header parsed but whose body has no considerations', () => {
    const parsed = parseCtisRfi(`${HEADER}\nDear sponsor, please find our invoice attached.`)
    const verdict = checkFileable(parsed)

    expect(parsed.documentRef).not.toBeNull()
    expect(parsed.considerations).toHaveLength(0)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) {
      expect(verdict.problem).toMatch(/no considerations could be read/i)
      // The reason has to name what WAS read, or the user cannot tell a wrong
      // file from a parser that failed on the right one.
      expect(verdict.problem).toContain('2024-519530-24-00')
    }
  })

  it('names which identifier is missing', () => {
    const noRef = checkFileable(parseCtisRfi(`2024-519530-24-00\n${BLOCK}`))
    expect(noRef.ok).toBe(false)
    if (!noRef.ok) {
      expect(noRef.problem).toContain('document reference')
      expect(noRef.problem).not.toContain('EU trial number')
    }

    const neither = checkFileable(parseCtisRfi(BLOCK))
    expect(neither.ok).toBe(false)
    if (!neither.ok) {
      expect(neither.problem).toContain('document reference')
      expect(neither.problem).toContain('EU trial number')
    }
  })
})
