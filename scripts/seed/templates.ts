/**
 * Hand-written skeleton considerations, one set per taxonomy category.
 *
 * These are written by hand on purpose (ADR-009). Fully LLM-generated corpora
 * read uniformly bland and give the game away to a regulatory audience. The
 * generator varies these through slot substitution and multiple phrasings per
 * category, which produces realistic variation with no model call — so
 * `npm run seed` works with no API key.
 *
 * Style anchor: the real CTIS export supplied with the problem statement.
 * Regulators write terse, imperative, slightly clipped English, often prefixed
 * with the Member State code. Responses are usually one or two flat sentences.
 *
 * Slots: {ms} {msName} {doc} {ver} {date} {amount} {site} {pi} {lang} {pol}
 *        {annex} {trial} {year}
 */

export interface Template {
  category: string
  /** Regulator's question. At least two phrasings per high-volume category. */
  consideration: string[]
  /** Approved sponsor response. Terse and factual, matching the real example. */
  response: string[]
}

export const TEMPLATES: Template[] = [
  // ---------------------------------------------------------------- Tier 1
  {
    category: 'FEE_PAYMENT_PROOF',
    consideration: [
      '{ms} - Please upload the proof of payment of the national fee for this application. The document was not found in the submitted dossier.',
      '{ms} - Proof of payment of the applicable national fee is missing. Please provide the bank transfer receipt referencing {pol}.',
      '{ms} - The dossier does not contain evidence that the national fee has been paid. Kindly upload the payment confirmation before the deadline.',
      '{ms} - No payment receipt has been identified for this submission. Please submit the proof of payment together with the reference number used for the transfer.',
    ],
    response: [
      'Proof of payment of the national fee is provided.',
      'The bank transfer receipt referencing {pol} has been uploaded in section {doc}.',
      'Payment confirmation is attached. The transfer was executed on {date}.',
    ],
  },
  {
    category: 'FEE_NATIONAL_UPDATE',
    consideration: [
      '{ms} - Please upload the proof of payment of the additional amount required by law for all applications submitted starting from 17 February 2025 due to ISTAT updated fee. You can find the additional amount to be paid in the same {pol} number you have already provided for this submission.',
      '{ms} - The national fee was revised with effect from {date}. The amount paid corresponds to the previous tariff. Please pay the difference of {amount} and upload the corresponding receipt.',
      '{ms} - The fee applied is not the tariff currently in force. Please provide proof of payment of the updated amount as published by the competent authority.',
      '{ms} - The submitted payment reflects the {year} tariff. Kindly upload evidence of payment of the additional amount required following the annual index revision.',
    ],
    response: [
      'Proof of payment of the additional amount required is provided.',
      'The additional amount of {amount} has been paid under {pol} and the receipt is attached.',
      'Payment of the difference resulting from the updated tariff has been made and evidence is uploaded in section {doc}.',
    ],
  },
  {
    category: 'FEE_REFERENCE_MISMATCH',
    consideration: [
      '{ms} - The payment reference indicated in the receipt does not correspond to {pol} provided for this submission. Please clarify or provide the correct document.',
      '{ms} - The reference number on the uploaded proof of payment cannot be reconciled with this application. Kindly submit a corrected receipt.',
    ],
    response: [
      'A corrected receipt quoting {pol} is provided.',
      'The reference has been verified with the finance department; the corrected proof of payment is attached.',
    ],
  },

  // ---------------------------------------------------------------- Tier 2
  {
    category: 'DOC_MISSING',
    consideration: [
      '{ms} - The document {doc} referenced in the cover letter is not present in the dossier. Please upload it.',
      '{ms} - {doc} is required for the validation of this application and could not be located. Kindly submit it within the deadline.',
      '{ms} - The application section for {doc} is empty. Please complete the dossier.',
    ],
    response: [
      '{doc} has been uploaded in the corresponding application section.',
      'The missing document is now provided. No changes have been made to its content.',
      '{doc} was inadvertently omitted and is attached to this response.',
    ],
  },
  {
    category: 'DOC_VERSION_MISMATCH',
    consideration: [
      '{ms} - The cover letter refers to {doc} version {ver} dated {date}, while the uploaded file is an earlier version. Please align the documentation.',
      '{ms} - Inconsistency identified between the version of {doc} listed in the application form and the version submitted. Kindly clarify which version applies.',
      '{ms} - The version number of {doc} does not match the version referenced in the protocol synopsis. Please upload the correct version.',
    ],
    response: [
      '{doc} version {ver} dated {date} has been uploaded, replacing the earlier version.',
      'The correct version {ver} is now provided. The version referenced in the cover letter is confirmed as applicable.',
    ],
  },
  {
    category: 'DOC_TRANSLATION_MISSING',
    consideration: [
      '{ms} - {doc} must be submitted in {lang}. Only the English version has been provided. Please upload the translated version.',
      '{ms} - A {lang} version of {doc} is required for subject-facing material. Kindly provide the translation.',
      '{ms} - The national requirement for documentation in {lang} is not met for {doc}. Please submit the missing language version.',
    ],
    response: [
      'The {lang} version of {doc} is provided.',
      '{doc} has been translated into {lang} and uploaded. The translation is consistent with the English source version {ver}.',
    ],
  },
  {
    category: 'DOC_NAMING_CONVENTION',
    consideration: [
      '{ms} - The file name of {doc} does not follow the required naming convention. Please rename and re-upload the document.',
      '{ms} - Uploaded documents must follow the convention specified by the competent authority. Kindly correct the naming of {doc}.',
    ],
    response: [
      '{doc} has been renamed in accordance with the required convention and re-uploaded.',
      'The naming has been corrected. Document content is unchanged.',
    ],
  },
  {
    category: 'DOC_SIGNATURE_DATE',
    consideration: [
      '{ms} - {doc} is not signed. Please upload a signed and dated version.',
      '{ms} - The signature date on {doc} is missing. Kindly provide a version bearing both signature and date.',
      '{ms} - {doc} has been signed by a person whose role is not stated. Please clarify the signatory and provide a corrected document.',
    ],
    response: [
      'A signed and dated version of {doc} is provided.',
      '{doc} signed on {date} is attached.',
    ],
  },
  {
    category: 'DOC_LEGIBILITY',
    consideration: [
      '{ms} - The scanned copy of {doc} is not legible. Please upload a readable version.',
      '{ms} - {doc} was submitted in a format that cannot be opened. Kindly re-upload in PDF.',
    ],
    response: [
      'A legible PDF version of {doc} is provided.',
      'The document has been rescanned at higher resolution and re-uploaded.',
    ],
  },

  // ---------------------------------------------------------------- Tier 3
  {
    category: 'ICF_CONTENT',
    consideration: [
      '{ms} - The informed consent form does not describe the subject\'s right to withdraw without justification. Please amend accordingly.',
      '{ms} - The information sheet does not adequately describe the processing of personal data. Kindly complete this section of the informed consent.',
      '{ms} - The informed consent form omits the contact details of the local investigator. Please add them.',
      '{ms} - The description of foreseeable risks in the information sheet is not consistent with the protocol section on safety. Please align the two documents.',
    ],
    response: [
      'The informed consent form has been amended and version {ver} dated {date} is provided.',
      'The requested information has been added to the information sheet. A revised version is uploaded.',
      'The informed consent has been updated to align with the protocol. Changes are marked in the tracked-changes version.',
    ],
  },
  {
    category: 'ICF_LOCAL_LANGUAGE',
    consideration: [
      '{ms} - The informed consent form must be submitted in {lang}. Please provide the local language version for site {site}.',
      '{ms} - Subject-facing documentation in {lang} has not been submitted. Kindly upload the informed consent in the required language.',
    ],
    response: [
      'The informed consent form in {lang} is provided.',
      'The {lang} version of the informed consent, version {ver}, has been uploaded for all participating sites.',
    ],
  },
  {
    category: 'INSURANCE_COVER',
    consideration: [
      '{ms} - The insurance certificate does not state coverage for {msName}. Please provide a certificate covering the territory.',
      '{ms} - The submitted insurance certificate expires on {date}, before the anticipated end of the trial. Kindly provide evidence of continued cover.',
      '{ms} - Proof of insurance or indemnification arrangements has not been provided. Please upload the certificate.',
    ],
    response: [
      'An insurance certificate covering {msName} is provided.',
      'A renewed certificate valid beyond the anticipated trial end date is attached.',
      'The insurance certificate is uploaded in the Part II documentation.',
    ],
  },
  {
    category: 'INVESTIGATOR_SUITABILITY',
    consideration: [
      '{ms} - The curriculum vitae of {pi} at site {site} is not dated. Please provide a signed and dated CV.',
      '{ms} - Evidence of GCP training for {pi} has not been submitted. Kindly upload the certificate.',
      '{ms} - The CV provided for {pi} is older than two years. Please submit a current version.',
    ],
    response: [
      'A signed and dated curriculum vitae for {pi} is provided.',
      'The GCP training certificate for {pi}, valid from {date}, is attached.',
      'An updated CV for {pi} has been uploaded.',
    ],
  },
  {
    category: 'SITE_SUITABILITY',
    consideration: [
      '{ms} - The suitability declaration for site {site} has not been submitted. Please provide it.',
      '{ms} - The facilities declaration for site {site} does not cover the storage conditions required for the investigational medicinal product. Kindly clarify.',
    ],
    response: [
      'The suitability declaration for site {site} is provided.',
      'Confirmation of the storage facilities at site {site} has been added to the declaration and uploaded.',
    ],
  },
  {
    category: 'DATA_PROTECTION',
    consideration: [
      '{ms} - The description of the personal data flow outside the European Union is incomplete. Please provide further detail.',
      '{ms} - The legal basis for processing personal data is not stated in the submitted documentation. Kindly clarify.',
    ],
    response: [
      'A detailed description of the data flow, including transfers outside the EU and the safeguards applied, is provided.',
      'The legal basis for processing has been added to the data protection documentation and the revised version is uploaded.',
    ],
  },
  {
    category: 'FINANCIAL_ARRANGEMENTS',
    consideration: [
      '{ms} - The arrangements for compensation of trial subjects are not described. Please complete the financial documentation.',
      '{ms} - The agreement covering payments to the investigator at site {site} has not been submitted. Kindly upload it.',
    ],
    response: [
      'A description of the compensation arrangements for trial subjects is provided.',
      'The financial agreement for site {site} is attached.',
    ],
  },
  {
    category: 'RECRUITMENT_MATERIAL',
    consideration: [
      '{ms} - The recruitment material referred to in the protocol has not been submitted for assessment. Please upload all subject-facing advertisements.',
      '{ms} - The advertisement submitted is not available in {lang}. Kindly provide the translated version.',
    ],
    response: [
      'All recruitment material intended for use in {msName} is provided.',
      'The {lang} version of the recruitment material is uploaded.',
    ],
  },
  {
    category: 'BIOLOGICAL_SAMPLES',
    consideration: [
      '{ms} - The arrangements for storage and future use of biological samples are not sufficiently described. Please clarify the retention period.',
      '{ms} - It is not clear whether subjects may consent separately to future use of their samples. Kindly clarify in the informed consent.',
    ],
    response: [
      'The retention period and the arrangements for future use of biological samples are described in the revised protocol section.',
      'A separate consent option for future use of samples has been added to the informed consent form, version {ver}.',
    ],
  },

  // ---------------------------------------------------------------- Tier 4
  {
    category: 'PROTOCOL_INCONSISTENCY',
    consideration: [
      'The number of subjects stated in the protocol synopsis does not match the number given in the statistical section. Please correct the inconsistency.',
      'The definition of the primary endpoint in section {annex} differs from the definition in the synopsis. Please align the two.',
      'The schedule of assessments is not consistent with the visit window described in the protocol body. Kindly clarify.',
    ],
    response: [
      'The protocol has been corrected. Version {ver} dated {date} is provided with the inconsistency resolved.',
      'The synopsis has been aligned with the statistical section. A tracked-changes version is attached.',
    ],
  },
  {
    category: 'PROTOCOL_DESIGN',
    consideration: [
      'Please justify the choice of comparator in the context of the intended population.',
      'The stopping rules for the trial are not described. Please clarify how subject safety will be monitored.',
      'Please clarify the rationale for the duration of the follow-up period.',
    ],
    response: [
      'A justification has been added to the protocol, section {annex}, and the revised version {ver} is provided.',
      'The safety monitoring arrangements, including stopping rules, are described in the amended protocol.',
    ],
  },
  {
    category: 'IMPD_QUALITY',
    consideration: [
      'The stability data provided for the investigational medicinal product do not cover the proposed shelf life. Please provide supporting data.',
      'The specification limits for the drug product are not justified. Please provide the rationale.',
      'The description of the manufacturing process for the drug substance is incomplete. Kindly provide further detail.',
    ],
    response: [
      'Additional stability data supporting the proposed shelf life are provided in the updated IMPD, section {annex}.',
      'A justification of the specification limits has been added to the IMPD Quality section.',
      'The manufacturing process description has been expanded in IMPD version {ver}.',
    ],
  },
  {
    category: 'IMPD_SAFETY_EFFICACY',
    consideration: [
      'The non-clinical data package does not include repeat-dose toxicity data at the proposed dose level. Please clarify.',
      'Please provide a justification of the starting dose in relation to the available non-clinical data.',
    ],
    response: [
      'The relevant non-clinical study reports have been added to the IMPD and the cross-references are updated.',
      'A justification of the starting dose is provided in section {annex} of the revised IMPD.',
    ],
  },
  {
    category: 'GMP_QP_DECLARATION',
    consideration: [
      'The QP declaration submitted does not cover the manufacturing site {site}. Please provide a declaration covering all sites.',
      'The QP declaration is not signed. Please upload a signed version.',
      'Evidence of GMP compliance for the manufacturing site has not been submitted. Kindly provide the certificate.',
    ],
    response: [
      'A QP declaration covering manufacturing site {site} is provided.',
      'The signed QP declaration dated {date} is attached.',
      'The GMP certificate for the manufacturing site is uploaded.',
    ],
  },
  {
    category: 'IB_VERSION',
    consideration: [
      "The Investigator's Brochure submitted is dated {date} and predates the current protocol version. Please confirm whether an updated version is available.",
      "The reference safety information in the Investigator's Brochure is not consistent with the protocol. Please clarify.",
    ],
    response: [
      "Investigator's Brochure version {ver} dated {date} is provided.",
      'The reference safety information has been aligned and the updated brochure is uploaded.',
    ],
  },
  {
    category: 'LABELLING',
    consideration: [
      '{ms} - The labelling of the investigational medicinal product does not include the text required in {lang}. Please provide compliant labelling.',
      '{ms} - The label mock-up does not include the expiry date format required nationally. Kindly correct.',
    ],
    response: [
      'Revised label mock-ups including the required {lang} text are provided.',
      'The labelling has been corrected and the updated mock-ups are attached.',
    ],
  },
  {
    category: 'AUXILIARY_MEDICINAL_PRODUCT',
    consideration: [
      'Documentation for the auxiliary medicinal product used in the trial has not been submitted. Please provide it.',
      'Please clarify the regulatory status of the auxiliary medicinal product in {msName}.',
    ],
    response: [
      'Documentation for the auxiliary medicinal product is provided.',
      'The auxiliary medicinal product is authorised in {msName}; the marketing authorisation reference is provided.',
    ],
  },

  // ---------------------------------------------------------------- Tier 5
  {
    category: 'APPLICATION_FORM_DATA',
    consideration: [
      'The number of participating sites in the application form does not match the number listed in the protocol. Please correct.',
      'The trial phase indicated in the application form differs from the phase stated in the protocol synopsis. Kindly clarify.',
      'The sponsor contact details in the application form are incomplete. Please complete them.',
    ],
    response: [
      'The application form has been corrected to reflect the information in the protocol.',
      'The discrepancy has been reviewed; the protocol is correct and the application form is updated accordingly.',
    ],
  },
  {
    category: 'SCOPE_CLARIFICATION',
    consideration: [
      'Please clarify whether the interventions described fall within the scope of Regulation (EU) No 536/2014.',
      'Please justify the classification of this trial as a low-intervention clinical trial.',
    ],
    response: [
      'A justification of the classification is provided in the revised cover letter.',
      'The sponsor confirms that the trial falls within the scope of the Regulation; the rationale is provided.',
    ],
  },
  {
    category: 'SM_JUSTIFICATION',
    consideration: [
      'The rationale for this substantial modification is not sufficiently described. Please expand the justification.',
      'Please clarify the impact of this substantial modification on subject safety and on the reliability of the data generated.',
      'The cover letter does not identify all documents affected by this substantial modification. Kindly provide a complete list.',
    ],
    response: [
      'An expanded rationale for the substantial modification is provided in the revised cover letter.',
      'An assessment of the impact on subject safety and data reliability has been added.',
      'A complete list of the affected documents, with version numbers, is attached.',
    ],
  },
]

// --------------------------------------------------------------------- Slots

export const DOCUMENT_NAMES: Record<string, string[]> = {
  Regulatory: ['Cover letter', 'Proof of payment', 'National annex'],
  'Cover Letter': ['Cover letter'],
  'EU Application Form': ['EU application form'],
  Protocol: ['Clinical trial protocol', 'Protocol synopsis'],
  'Investigator Brochure': ["Investigator's Brochure"],
  'IMPD Quality': ['IMPD Quality section', 'IMPD S.4 Control of drug substance'],
  'IMPD Safety and Efficacy': ['IMPD Safety and Efficacy section'],
  'GMP and QP Declaration': ['QP declaration', 'GMP certificate'],
  'Auxiliary Medicinal Product': ['Auxiliary medicinal product dossier'],
  'IMP Labelling': ['IMP label mock-up', 'Labelling annex'],
  'Scientific Advice and PIP': ['Scientific advice letter', 'PIP decision'],
  'Informed Consent': ['Informed consent form', 'Subject information sheet'],
  'Subject Recruitment Arrangements': ['Recruitment advertisement', 'Subject recruitment plan'],
  'Investigator Suitability': ['Investigator CV', 'GCP training certificate'],
  'Site Suitability': ['Site suitability declaration', 'Facilities declaration'],
  'Insurance and Indemnification': ['Insurance certificate', 'Indemnification statement'],
  'Financial Arrangements': ['Financial agreement', 'Subject compensation description'],
  'Data Protection': ['Data protection annex', 'Data flow description'],
  'Biological Samples': ['Biological sample handling plan'],
}

export const INVESTIGATORS = [
  'Dr M. Larsen', 'Prof. A. Rossi', 'Dr C. Fernández', 'Dr K. Novak',
  'Prof. H. Müller', 'Dr S. Dubois', 'Dr J. Kowalski', 'Prof. E. Jansen',
  'Dr L. Andersson', 'Dr P. Virtanen', 'Prof. R. Silva', 'Dr T. Horvath',
]

export const SITES = [
  'IT-014', 'IT-027', 'ES-003', 'ES-119', 'DE-042', 'DE-088', 'FR-011',
  'FR-076', 'PL-005', 'PL-061', 'NL-022', 'BE-009', 'DK-002', 'SE-017',
  'FI-004', 'CZ-031', 'HU-013', 'PT-008', 'AT-006', 'IE-001',
]

export const LANGUAGES: Record<string, string> = {
  IT: 'Italian', ES: 'Spanish', DE: 'German', FR: 'French', PL: 'Polish',
  NL: 'Dutch', BE: 'Dutch and French', DK: 'Danish', SE: 'Swedish',
  FI: 'Finnish', CZ: 'Czech', HU: 'Hungarian', PT: 'Portuguese',
  AT: 'German', IE: 'English',
}

export const THERAPEUTIC_AREAS = [
  'Type 2 Diabetes', 'Obesity', 'Haemophilia A', 'Growth Hormone Deficiency',
  'Type 1 Diabetes', 'Chronic Kidney Disease', 'Cardiovascular Risk Reduction',
  'Non-alcoholic Steatohepatitis', 'Sickle Cell Disease', 'Alzheimer\'s Disease',
]

export const TRIAL_PHASES = ['Phase I', 'Phase II', 'Phase IIIa', 'Phase IIIb', 'Phase IV']

export const ANNEX_REFS = [
  'Annex 5', 'Annex 12', 'Annex 15', 'Section 6.2', 'Section 9.4',
  'Section 3.2.P.8', 'Appendix B',
]
