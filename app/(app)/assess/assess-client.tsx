'use client'

import { useMemo, useState, useTransition } from 'react'
import {
  ALL_SECTIONS,
  MEMBER_STATES,
  PART_II_SECTIONS,
  type SubmissionType,
} from '@/lib/domain/taxonomy'
import { artefactPromptsFor } from '@/lib/risk/rules'
import { BAND_GUIDANCE } from '@/lib/risk/score'
import type { RiskBand, SectionAssessment } from '@/lib/risk/types'
import { assessAction, type AssessState } from './actions'
import { STARTER_SECTIONS } from './starter'

const PART_II = new Set<string>(PART_II_SECTIONS)

const BAND_STYLE: Record<RiskBand, string> = {
  HIGH: 'bg-risk-soft text-risk',
  MEDIUM: 'bg-warn-soft text-warn',
  LOW: 'bg-ok-soft text-ok',
}

const SUBMISSION_LABELS: Record<SubmissionType, string> = {
  INITIAL: 'Initial application',
  SUBSTANTIAL_MODIFICATION: 'Substantial modification',
  ADDITIONAL_MS: 'Additional Member State',
}

/** `true` present, `false` absent, `undefined` not declared. */
type Declared = Record<string, boolean | string[] | undefined>

interface SectionDraft {
  key: string
  section: string
  content: string
  artefacts: Declared
}

function partOf(section: string): 'PART_I' | 'PART_II' {
  return PART_II.has(section) ? 'PART_II' : 'PART_I'
}

export function AssessClient() {
  const [submissionType, setSubmissionType] = useState<SubmissionType>('INITIAL')
  const [memberStates, setMemberStates] = useState<string[]>(['IT', 'ES'])
  const [sections, setSections] = useState<SectionDraft[]>(() =>
    STARTER_SECTIONS.map((s, i) => ({ key: `s${i}`, ...s })),
  )
  const [state, setState] = useState<AssessState>({})
  const [pending, startTransition] = useTransition()

  const usedSections = useMemo(() => new Set(sections.map((s) => s.section)), [sections])

  function toggleMemberState(code: string) {
    setMemberStates((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    )
  }

  function updateSection(key: string, patch: Partial<SectionDraft>) {
    setSections((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)))
  }

  function setArtefact(key: string, artefact: string, value: boolean | string[] | undefined) {
    setSections((prev) =>
      prev.map((s) =>
        s.key === key ? { ...s, artefacts: { ...s.artefacts, [artefact]: value } } : s,
      ),
    )
  }

  function submit() {
    setState({})
    startTransition(async () => {
      const result = await assessAction({
        submissionType,
        memberStates,
        sections: sections.map((s) => ({
          section: s.section,
          sectionPart: partOf(s.section),
          content: s.content,
          // undefined means "not declared" and must survive the round trip as
          // null, not be dropped by JSON.stringify.
          artefacts: Object.fromEntries(
            Object.entries(s.artefacts).map(([k, v]) => [k, v === undefined ? null : v]),
          ),
        })),
      })
      setState(result)
    })
  }

  const assessment = state.assessment

  return (
    <div className="space-y-6">
      {/* ----------------------------------------------------------- Scope */}
      <section className="rounded-lg border border-border bg-surface p-5">
        <h2 className="text-base font-semibold">Scope</h2>
        <p className="mt-1 text-sm text-muted">
          National checks only run for the Member States this application is actually going to.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="submissionType"
              className="mb-1 block text-[11px] font-medium tracking-wide text-muted uppercase"
            >
              Submission type
            </label>
            <select
              id="submissionType"
              value={submissionType}
              onChange={(e) => setSubmissionType(e.target.value as SubmissionType)}
              className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm"
            >
              {Object.entries(SUBMISSION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <span className="mb-1 block text-[11px] font-medium tracking-wide text-muted uppercase">
              Member States Concerned
            </span>
            <div className="flex flex-wrap gap-1.5">
              {MEMBER_STATES.map((ms) => {
                const on = memberStates.includes(ms.code)
                return (
                  <button
                    key={ms.code}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleMemberState(ms.code)}
                    title={ms.name}
                    className={`rounded px-2 py-1 text-xs font-medium transition ${
                      on ? 'bg-accent text-white' : 'bg-background text-muted hover:bg-accent-soft'
                    }`}
                  >
                    {ms.code}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- Sections */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Sections to check</h2>
          <AddSection
            used={usedSections}
            onAdd={(section) =>
              setSections((prev) => [
                ...prev,
                { key: `s${Date.now()}`, section, content: '', artefacts: {} },
              ])
            }
          />
        </div>

        {sections.map((draft) => (
          <SectionCard
            key={draft.key}
            draft={draft}
            memberStates={memberStates}
            submissionType={submissionType}
            onChange={(patch) => updateSection(draft.key, patch)}
            onArtefact={(artefact, value) => setArtefact(draft.key, artefact, value)}
            onRemove={() => setSections((prev) => prev.filter((s) => s.key !== draft.key))}
          />
        ))}
      </section>

      {state.error && (
        <p role="alert" className="rounded-md bg-risk-soft px-3.5 py-2.5 text-sm text-risk">
          {state.error}
        </p>
      )}

      <div className="flex items-center gap-4 border-t border-border pt-5">
        <button
          type="button"
          onClick={submit}
          disabled={pending || sections.length === 0}
          className="rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
        >
          {pending ? 'Checking…' : 'Check before submitting'}
        </button>
        <p className="text-xs text-muted">
          Nothing is written to the repository. This reads it.
        </p>
      </div>

      {/* --------------------------------------------------------- Results */}
      {assessment && <Results sections={assessment.sections} />}
    </div>
  )
}

function AddSection({
  used,
  onAdd,
}: {
  used: Set<string>
  onAdd: (section: string) => void
}) {
  const available = ALL_SECTIONS.filter((s) => !used.has(s))
  if (available.length === 0) return null

  return (
    <select
      value=""
      aria-label="Add a section"
      onChange={(e) => {
        if (e.target.value) onAdd(e.target.value)
      }}
      className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm"
    >
      <option value="">Add a section…</option>
      {available.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  )
}

function SectionCard({
  draft,
  memberStates,
  submissionType,
  onChange,
  onArtefact,
  onRemove,
}: {
  draft: SectionDraft
  memberStates: string[]
  submissionType: SubmissionType
  onChange: (patch: Partial<SectionDraft>) => void
  onArtefact: (artefact: string, value: boolean | string[] | undefined) => void
  onRemove: () => void
}) {
  // The same function the engine uses, so the form cannot ask for an artefact
  // the engine ignores, or omit one it will mark unchecked.
  const prompts = useMemo(
    () =>
      artefactPromptsFor({
        section: draft.section,
        sectionPart: partOf(draft.section),
        content: draft.content,
        artefacts: {},
        memberStates,
        submissionType,
      }),
    [draft.section, draft.content, memberStates, submissionType],
  )

  return (
    <article className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">
          {draft.section}
          <span className="ml-2 text-xs font-normal text-muted">
            {partOf(draft.section) === 'PART_I' ? 'Part I' : 'Part II'}
          </span>
        </h3>
        <button type="button" onClick={onRemove} className="text-xs text-accent hover:underline">
          Remove
        </button>
      </div>

      <label htmlFor={`c-${draft.key}`} className="sr-only">
        {draft.section} text
      </label>
      <textarea
        id={`c-${draft.key}`}
        value={draft.content}
        onChange={(e) => onChange({ content: e.target.value })}
        rows={3}
        placeholder="Paste the draft text for this section…"
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] leading-relaxed"
      />

      {prompts.length > 0 && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="mb-2 text-[11px] font-medium tracking-wide text-muted uppercase">
            Checklist
          </p>
          <div className="space-y-2">
            {prompts.map((prompt) =>
              prompt.kind === 'languages' ? (
                <LanguagePicker
                  key={prompt.key}
                  memberStates={memberStates}
                  value={
                    Array.isArray(draft.artefacts[prompt.key])
                      ? (draft.artefacts[prompt.key] as string[])
                      : undefined
                  }
                  onChange={(value) => onArtefact(prompt.key, value)}
                />
              ) : (
                <TriState
                  key={prompt.key}
                  label={prompt.label}
                  hint={prompt.memberStates.join(', ')}
                  value={
                    typeof draft.artefacts[prompt.key] === 'boolean'
                      ? (draft.artefacts[prompt.key] as boolean)
                      : undefined
                  }
                  onChange={(value) => onArtefact(prompt.key, value)}
                />
              ),
            )}
          </div>
        </div>
      )}
    </article>
  )
}

/**
 * Yes / No / Not declared.
 *
 * The third option is not a convenience. "Not declared" must be distinguishable
 * from "absent", or an application nobody filled in reads as high risk.
 */
function TriState({
  label,
  hint,
  value,
  onChange,
}: {
  label: string
  hint?: string
  value: boolean | undefined
  onChange: (value: boolean | undefined) => void
}) {
  const options: { label: string; v: boolean | undefined }[] = [
    { label: 'Yes', v: true },
    { label: 'No', v: false },
    { label: 'Not declared', v: undefined },
  ]

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="min-w-56 flex-1 capitalize">
        {label}
        {hint ? <span className="ml-1.5 text-xs text-muted">({hint})</span> : null}
      </span>
      <div role="group" aria-label={label} className="flex overflow-hidden rounded-md border border-border">
        {options.map((option) => (
          <button
            key={option.label}
            type="button"
            aria-pressed={value === option.v}
            onClick={() => onChange(option.v)}
            className={`px-2.5 py-1 text-xs transition ${
              value === option.v
                ? option.v === false
                  ? 'bg-risk text-white'
                  : option.v === true
                    ? 'bg-ok text-white'
                    : 'bg-muted text-white'
                : 'bg-surface text-muted hover:bg-background'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function LanguagePicker({
  memberStates,
  value,
  onChange,
}: {
  memberStates: string[]
  value: string[] | undefined
  onChange: (value: string[] | undefined) => void
}) {
  const languages = useMemo(() => {
    const set = new Set<string>()
    for (const code of memberStates) {
      const ms = MEMBER_STATES.find((m) => m.code === code)
      ms?.languages.forEach((l) => set.add(l))
    }
    return [...set].sort()
  }, [memberStates])

  if (languages.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="min-w-56 flex-1">Local-language versions attached</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {languages.map((lang) => {
          const on = value?.includes(lang) ?? false
          return (
            <button
              key={lang}
              type="button"
              aria-pressed={on}
              onClick={() =>
                onChange(
                  on
                    ? (value ?? []).filter((l) => l !== lang)
                    : [...(value ?? []), lang],
                )
              }
              className={`rounded px-2 py-1 text-xs font-medium uppercase transition ${
                on ? 'bg-ok text-white' : 'bg-background text-muted hover:bg-accent-soft'
              }`}
            >
              {lang}
            </button>
          )
        })}
        <button
          type="button"
          aria-pressed={value === undefined}
          onClick={() => onChange(undefined)}
          className={`rounded px-2 py-1 text-xs transition ${
            value === undefined ? 'bg-muted text-white' : 'bg-surface text-muted hover:bg-background'
          }`}
        >
          Not declared
        </button>
      </div>
    </div>
  )
}

function Results({ sections }: { sections: SectionAssessment[] }) {
  const high = sections.filter((s) => s.band === 'HIGH').length

  return (
    <section className="space-y-3 border-t border-border pt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">
          Per-section result{sections.length === 1 ? '' : 's'}
        </h2>
        <p className="text-sm text-muted">
          {high === 0
            ? 'Nothing banded high.'
            : `${high} section${high === 1 ? '' : 's'} to fix before submitting.`}
        </p>
      </div>

      <p className="text-xs text-muted">
        Scored per section, never as one number for the application — a single score is not
        actionable. Band thresholds are provisional until calibrated against labelled outcomes.
      </p>

      {sections.map((s) => (
        <article key={s.section} className="rounded-lg border border-border bg-surface p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${BAND_STYLE[s.band]}`}>
              {s.band}
            </span>
            <h3 className="text-sm font-medium">{s.section}</h3>
            <span className="ml-auto font-mono text-sm">{s.score}</span>
          </div>

          <p className="mt-2 rounded-md bg-accent-soft px-3 py-2 text-[13px] text-accent">
            <strong className="font-medium">Do this: </strong>
            {s.recommendedAction}
          </p>

          <p className="mt-2 text-xs text-muted">{s.explanation}</p>

          {s.findings.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {s.findings.map((f) => (
                <li key={f.ruleId + (f.memberState ?? '')} className="flex gap-2 text-[13px]">
                  <span aria-hidden className="text-risk">
                    ✕
                  </span>
                  <span>
                    {f.memberState && (
                      <span className="mr-1.5 rounded bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent">
                        {f.memberState}
                      </span>
                    )}
                    {f.message}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {s.precedents.length > 0 && (
            <details className="mt-3 border-t border-border pt-3">
              <summary className="cursor-pointer text-xs text-accent">
                {s.precedents.length} similar past request
                {s.precedents.length === 1 ? '' : 's'}
              </summary>
              <ul className="mt-2 space-y-2">
                {s.precedents.map((p) => (
                  <li key={p.considerationId} className="rounded-md bg-background p-3 text-[13px]">
                    <div className="mb-1 flex flex-wrap gap-2 text-[11px] text-muted">
                      {p.memberState && <span>{p.memberState}</span>}
                      <span>{p.category.replaceAll('_', ' ').toLowerCase()}</span>
                      <span className="ml-auto font-mono">{p.similarity.toFixed(2)}</span>
                    </div>
                    <p>{p.consideration}</p>
                    {p.approvedResponse && (
                      <p className="mt-1.5 border-l-2 border-ok pl-2 text-muted">
                        {p.approvedResponse}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {s.unchecked.length > 0 && (
            <p className="mt-3 rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">
              {s.unchecked.length} check{s.unchecked.length === 1 ? '' : 's'} could not run —
              the artefact was not declared. {BAND_GUIDANCE[s.band]}
            </p>
          )}
        </article>
      ))}
    </section>
  )
}
