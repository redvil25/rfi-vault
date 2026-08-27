'use server'

import { z } from 'zod'
import { getCurrentUser } from '@/lib/db/server'
import { log } from '@/lib/log'
import { consumeRateLimit } from '@/lib/rate-limit'
import { assessDraft, type DraftAssessment } from '@/lib/risk/assess'
import { ALL_SECTIONS, MEMBER_STATE_BY_CODE } from '@/lib/domain/taxonomy'

/**
 * Feature 2's boundary. Assessment reads the repository and writes nothing, so
 * there is no audit event here — `audit_events` records state changes, and
 * padding it with read-only activity would dilute the one table whose integrity
 * is the point (ADR-007). Persisting an assessment into `risk_assessment` is a
 * separate decision, and would come with its own audit event.
 */

const SECTION_NAMES = new Set<string>(ALL_SECTIONS)

const artefactValue = z.union([z.boolean(), z.array(z.string().max(12)).max(10), z.null()])

const sectionSchema = z.object({
  section: z.string().refine((s) => SECTION_NAMES.has(s), 'Unknown application section'),
  sectionPart: z.enum(['PART_I', 'PART_II']),
  // Generous, but bounded: this text is embedded, and an unbounded body is both
  // a cost and a denial-of-service surface.
  content: z.string().max(20_000),
  artefacts: z.record(z.string().max(60), artefactValue),
})

const assessSchema = z.object({
  submissionType: z.enum(['INITIAL', 'SUBSTANTIAL_MODIFICATION', 'ADDITIONAL_MS']),
  memberStates: z
    .array(z.string().length(2).toUpperCase())
    .max(15)
    .refine((codes) => codes.every((c) => MEMBER_STATE_BY_CODE.has(c)), 'Unknown Member State'),
  sections: z.array(sectionSchema).min(1, 'Add at least one section').max(25),
})

export type AssessInput = z.infer<typeof assessSchema>

export interface AssessState {
  error?: string
  assessment?: DraftAssessment
}

export async function assessAction(input: unknown): Promise<AssessState> {
  const user = await getCurrentUser()
  if (!user) return { error: 'You are not signed in.' }

  // Each section may embed, so this is a paid endpoint as well as a slow one.
  const limited = await consumeRateLimit(`assess:${user.id}`, 20, 300)
  if (!limited.allowed) {
    return { error: `Too many assessments. Try again in ${limited.retryAfterSeconds} seconds.` }
  }

  const parsed = assessSchema.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return { error: `${issue.path.join('.') || 'input'}: ${issue.message}` }
  }

  const { submissionType, memberStates, sections } = parsed.data

  // Member States and submission type are application-level, but every rule is
  // evaluated per section, so each section carries them.
  const inputs = sections.map((section) => ({
    ...section,
    memberStates,
    submissionType,
  }))

  try {
    const assessment = await assessDraft(inputs, submissionType, memberStates)
    log.info('risk.assessed', {
      sections: sections.length,
      memberStates: memberStates.length,
      submissionType,
      high: assessment.sections.filter((s) => s.band === 'HIGH').length,
    })
    return { assessment }
  } catch (err) {
    log.error('risk.assess_failed', { sections: sections.length }, err)
    return { error: 'The assessment could not be completed. Nothing was changed.' }
  }
}
