/**
 * A worked example, so the page is useful the moment it loads rather than an
 * empty form nobody knows how to fill in.
 *
 * This is synthetic draft text of the kind a sponsor writes, not regulatory
 * guidance: nothing here asserts an article number, a deadline or a fee amount
 * (CLAUDE.md §8). Every checklist value is editable, and the assessment reads
 * whatever is on screen at the time.
 *
 * The five sections are chosen to exercise each path the engine has, so the
 * demo shows the whole behaviour rather than one happy case:
 *
 *   Regulatory            — a declared-absent artefact, the clearest finding
 *   Informed Consent      — a national rule failing for one Member State only
 *   Protocol              — a content rule, read from the text not a checkbox
 *   IMPD Quality          — no checklist rule exists; similarity carries it
 *   GMP and QP Declaration — everything declared present, the clean case
 */

export interface StarterSection {
  section: string
  content: string
  artefacts: Record<string, boolean | string[] | undefined>
}

export const STARTER_SECTIONS: StarterSection[] = [
  {
    section: 'Regulatory',
    content:
      'Cover documentation for the national submission. Payment for the national ' +
      'fee was initiated by the affiliate finance team; the bank confirmation has ' +
      'not yet been returned and is not attached to this dossier.',
    artefacts: {
      fee_proof: false,
      fee_reference: true,
      // Left undeclared on purpose: shows how an unanswered check is reported as
      // unchecked rather than counted as a failure.
      fee_proof_current_tariff: undefined,
    },
  },
  {
    section: 'Informed Consent',
    content:
      'Informed consent form and subject information sheet, version 3.0. The ' +
      'Italian translation has been completed and reviewed by the local affiliate.',
    artefacts: {
      icf_present: true,
      icf_local_lang: true,
      // Italian attached, Spanish not — with IT and ES both selected, exactly one
      // national rule should fail.
      local_language_versions: ['it'],
    },
  },
  {
    section: 'Protocol',
    content:
      'The clinical trial protocol version 4.1 is submitted. Section 6 of the ' +
      'cover letter refers to protocol version 3.0, which was the version ' +
      'circulated for internal review before the amendment was finalised.',
    artefacts: {
      document_present: true,
      naming_convention: true,
      legibility: true,
    },
  },
  {
    section: 'IMPD Quality',
    content:
      'Stability data for the investigational medicinal product are provided for ' +
      'twelve months at the intended storage condition. The proposed shelf life ' +
      'is twenty-four months, supported by an ongoing stability programme.',
    artefacts: {
      document_present: true,
      legibility: true,
    },
  },
  {
    section: 'GMP and QP Declaration',
    content:
      'Qualified Person declaration covering the manufacturing site named in the ' +
      'application form, signed and dated by the responsible QP.',
    artefacts: {
      qp_declaration: true,
      signature_present: true,
      document_present: true,
      legibility: true,
    },
  },
]
