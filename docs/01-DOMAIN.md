# 01 — Domain Knowledge: EU CTR, CTIS, and RFIs

> This is the document that separates a winning submission from a generic "search your PDFs with AI" demo. The judges are Novo Nordisk regulatory affairs professionals. They will notice within ninety seconds whether you actually understand their workflow.
>
> Items marked **[VERIFY]** are stated from general knowledge and **must be confirmed** against EMA guidance or the Novo Nordisk mentor before appearing in the deck or report. Do not put an unverified number on a slide.

## 1. The regulatory frame

**Regulation (EU) No 536/2014** — the Clinical Trials Regulation (EU CTR) — replaced the old Clinical Trials Directive 2001/20/EC. It became applicable on 31 January 2022, with a transition period that ended 30 January 2025. Every clinical trial in the EU/EEA now runs under EU CTR.

**CTIS** — the Clinical Trials Information System — is the single EU portal and database through which sponsors submit clinical trial applications (CTAs) and through which Member States assess them. It is operated by EMA. One submission, many Member States.

**Key roles:**
- **Sponsor** — Novo Nordisk. Submits the application, answers RFIs.
- **RMS (Reporting Member State)** — the single Member State that coordinates the Part I assessment on behalf of all Member States Concerned.
- **MSC (Member State Concerned)** — every Member State where the sponsor wants to run the trial. Each does its own Part II assessment.

## 2. Application structure — Part I and Part II

This split is fundamental. RFIs are always tagged to one of these, and to a section within it. Our data model mirrors it exactly.

**Part I — scientific and product-related, assessed jointly, coordinated by the RMS:**
- Cover letter and EU application form
- Protocol
- Investigator's Brochure (IB)
- IMPD — Quality (chemistry, manufacturing, controls)
- IMPD — Safety and Efficacy (non-clinical and clinical)
- GMP compliance documentation / QP declaration on IMP manufacturing and import
- Auxiliary medicinal product documentation
- Scientific advice and PIP (Paediatric Investigation Plan) documentation
- Labelling of IMP

**Part II — national, ethical and local, assessed by each MSC independently:**
- Informed consent form (ICF) and subject information sheet, in the local language
- Arrangements for recruitment of subjects (advertisements, recruitment material)
- Suitability of the investigator and of the trial site / facilities (CVs, site declarations)
- Proof of insurance cover or indemnification / damage compensation arrangements
- Financial arrangements — payments to subjects and investigators
- Compliance with data protection rules (GDPR)
- Compliance with rules on collection, storage and future use of biological samples

**Practical consequence for our product:** the same trial can receive a Part I RFI once (from the RMS, on behalf of everyone) and a Part II RFI *separately from each of ten Member States*, often about the same class of issue in ten different languages and formats. This is exactly the duplicated-effort problem the problem statement describes, and it is the strongest argument for a shared repository. **Say this explicitly in the pitch.**

## 3. The two phases where RFIs appear

### 3.1 Validation phase — the primary scope of this problem statement

After submission, Member States check whether the application is **complete and in scope**. This is a completeness/compliance check, not a scientific one.

- **[VERIFY]** Member States report on validation within **10 days** of submission.
- **[VERIFY]** If the dossier is incomplete, the sponsor is asked to comment or complete within a maximum of **10 days**.
- **[VERIFY]** The RMS then has a further **5 days** to validate.
- **[VERIFY]** If the sponsor does not respond within the deadline, **the application lapses in all Member States Concerned** — the sponsor must resubmit from scratch.

That last point is the business stake. A validation RFI is not a minor annoyance; missing the clock destroys the submission and restarts a multi-week cycle across every country.

Validation RFIs are overwhelmingly **administrative and repeatable**: missing fee proof, wrong document version, missing local-language translation, unsigned CV, wrong file naming, missing national annex. Repeatable means **learnable**, which is precisely why a repository plus pattern detection works here. This is the analytical core of our pitch — the RFIs that cost the most time are the ones that are most predictable.

### 3.2 Assessment phase — secondary scope, supported by the same model

- **Part I assessment:** **[VERIFY]** 45 days from the validation date, extendable by up to 31 days when the RMS raises a request for information; sponsor response due within a maximum of **12 days**; the RMS then has a review window to finalise.
- **Part II assessment:** **[VERIFY]** 45 days per MSC, with a comparable RFI and extension mechanism.
- **Decision:** **[VERIFY]** notified within 5 days of the Part I reporting date or the last Part II assessment, whichever is later.
- **Additional extensions** apply for ATMPs and where expert consultation is needed.

### 3.3 Substantial modifications

A substantial modification (SM) to an authorised trial goes through its own validation and assessment cycle with shorter clocks (**[VERIFY]** validation ~6 days, Part I assessment ~38 days, sponsor RFI response ~12 days). The example RFI supplied to the team is an SM — document reference `CT-2024-519530-24-00-SM06-001`. **The data model must handle SM RFIs as first-class, not as an afterthought.**

## 4. Anatomy of an RFI record — taken from the supplied example

The real CTIS export the team was shown has this exact shape. Our ingestion parser and our synthetic generator both target it.

```
Trial / application ID:     2024-519530-24-00
Submission type:            SUBSTANTIAL MODIFICATION
Document reference:         CT-2024-519530-24-00-SM06-001 — Requests for information
Date / time:                05/08/2026 12:5x

  Consideration number:     1
  Application section parts: Part I - Regulatory
  Application section and document: <section, document name>
  Consideration:            "IT - Please upload the proof of payment of the additional
                             amount required by law for all applications submitted
                             starting from 17 February 2025 due to ISTAT updated fee.
                             For your reference: https://www.aifa.gov.it/... (attached 1).
                             You can find the additional amount to be paid in the same
                             POL number you have already provided for this submission."
  Sponsor response:         "Proof of payment of the additional amount required is provided."
```

**Fields we extract from every RFI:**

| Field | Notes |
|---|---|
| `trial_id` | EU trial number, e.g. `2024-519530-24-00` |
| `document_ref` | e.g. `CT-2024-519530-24-00-SM06-001` |
| `submission_type` | `INITIAL` \| `SUBSTANTIAL_MODIFICATION` \| `ADDITIONAL_MS` |
| `phase` | `VALIDATION` \| `ASSESSMENT_PART_I` \| `ASSESSMENT_PART_II` |
| `consideration_number` | integer, unique within the document |
| `section_part` | `PART_I` \| `PART_II` |
| `section` | e.g. `Regulatory`, `Protocol`, `IMPD_QUALITY`, `ICF` |
| `document_name` | the specific document the RFI points at |
| `member_state` | ISO country code — note the `IT -` prefix convention in the consideration text |
| `consideration_text` | the regulator's question |
| `sponsor_response_text` | the approved answer |
| `response_status` | `DRAFT` \| `IN_REVIEW` \| `APPROVED` \| `SUBMITTED` |
| `issued_at`, `due_at`, `responded_at` | for clock analytics |
| `category` | our derived taxonomy — see §5 |
| `outcome` | `ACCEPTED` \| `FOLLOW_UP_RFI` \| `UNKNOWN` — is the response known to have worked? |

**Two observations from the example that we exploit as product features:**
1. The consideration text is **prefixed with the Member State code** (`IT -`). Country is machine-extractable, and country-specific national requirements are the single most duplicated RFI class.
2. The approved sponsor response is often **one short sentence**. The value is not in writing the sentence — it is in knowing *which* sentence plus *which attachment* satisfied the regulator last time. That reframes our product: it is a **precedent engine**, not a text generator. Use this line in the pitch.

## 5. RFI category taxonomy — our contribution

There is no official taxonomy. Inventing a good one is genuine domain work and is worth Innovation points. Present it as a slide.

**Tier 1 — Administrative / Fees (highest volume, highest preventability)**
- `FEE_PAYMENT_PROOF` — proof of national fee payment missing or wrong amount
- `FEE_NATIONAL_UPDATE` — national fee changed (the ISTAT example); sponsor paid the old amount
- `FEE_REFERENCE_MISMATCH` — POL / reference number does not match the submission

**Tier 2 — Document management**
- `DOC_MISSING` — a required document is absent from the dossier
- `DOC_VERSION_MISMATCH` — protocol v3.0 referenced but v2.0 uploaded
- `DOC_NAMING_CONVENTION` — file naming does not follow the MS or CTIS convention
- `DOC_SIGNATURE_DATE` — unsigned or undated document
- `DOC_TRANSLATION_MISSING` — local-language version required and absent
- `DOC_LEGIBILITY` — scanned document unreadable / wrong format

**Tier 3 — Part II national and ethical**
- `ICF_CONTENT` — informed consent wording, missing GDPR clause, missing withdrawal rights
- `ICF_LOCAL_LANGUAGE` — ICF not in required language(s)
- `INSURANCE_COVER` — insurance certificate missing, expired, or wrong territory
- `INVESTIGATOR_SUITABILITY` — CV missing, outdated, unsigned; GCP training evidence absent
- `SITE_SUITABILITY` — site facility declaration missing
- `DATA_PROTECTION` — GDPR / data-flow description inadequate
- `FINANCIAL_ARRANGEMENTS` — subject compensation or investigator payment detail missing
- `RECRUITMENT_MATERIAL` — advertisement not submitted or not approved

**Tier 4 — Part I scientific**
- `PROTOCOL_INCONSISTENCY` — internal contradictions, endpoint/statistics mismatch
- `PROTOCOL_DESIGN` — design or safety-monitoring question
- `IMPD_QUALITY` — CMC gap, stability data, specification justification
- `IMPD_SAFETY_EFFICACY` — non-clinical or clinical data gap
- `GMP_QP_DECLARATION` — QP declaration missing or not covering the manufacturing site
- `IB_VERSION` — Investigator's Brochure outdated relative to the protocol
- `LABELLING` — IMP labelling annex non-compliant with local rules
- `AUXILIARY_MEDICINAL_PRODUCT` — auxiliary product documentation gap

**Tier 5 — Application form and scope**
- `APPLICATION_FORM_DATA` — inconsistency between the EU application form and the dossier
- `SCOPE_CLARIFICATION` — whether the trial falls in scope of the Regulation
- `SM_JUSTIFICATION` — substantial modification rationale insufficient

**Design rule:** the real-world distribution is heavily Pareto — a small number of categories account for most RFIs. Our synthetic corpus must reproduce that shape (see `docs/03-DATA-MODEL.md`), because the analytics dashboard is only persuasive if the distribution looks like reality.

## 6. Known national quirks — the highest-value knowledge in the repository

These are the recurring, country-specific traps. Each one is a concrete demo moment and each one appears in the seeded corpus.

| Member State | Recurring issue |
|---|---|
| Italy (IT) | Fee updated annually by ISTAT index; sponsors submit proof of the previous year's amount. AIFA reference decree must be cited. Exactly the supplied example. |
| Spain (ES) | AEMPS + CEIm; local-language ICF and specific contract/insurance formalities |
| Germany (DE) | BfArM/PEI plus the ethics committee; radiation-protection and specific national annexes |
| France (FR) | ANSM plus CPP; strict document formalities and language requirements |
| Poland (PL) | Insurance cover terms and translated documents |
| Nordics (DK, SE, NO*, FI) | Generally lighter national annexes; biobank/sample rules matter |
| Netherlands (NL) | CCMO-specific formats |

*Norway participates via the EEA.

**[VERIFY] all of the above with the mentor.** Present them as "patterns our corpus models", not as legal advice.

## 7. Who the users are — from the problem statement

The problem statement names four groups. Our RBAC model is built on exactly these, which is an easy and highly visible credibility win.

| Role | What they need |
|---|---|
| **RA Clinical** | Owns the scientific/Part I response. Needs precedent for protocol and IMPD questions. |
| **Affiliates** | Local country teams. Own Part II and national requirements. Need country-specific precedent in their own MS context. |
| **CTA Management** | Coordinates the dossier and the clock. Needs status, deadlines, and who owes what. |
| **EU Submission Hub** | Submits into CTIS and is the last line before the regulator. Needs quality control and completeness checks, and precedent for whatever the regulator sends back. |

## 8. The business case arithmetic

Use this structure in the deck. Fill the assumptions with mentor-validated numbers if you can get them; otherwise state them clearly as assumptions with a sensitivity range. **Judges respect an honest assumption far more than a fabricated statistic.**

```
A  Applications per year (given)                     650
B  Share receiving at least one validation RFI       [VERIFY with mentor] — model 30%–50%
C  Average considerations per RFI document           [VERIFY] — model 2–4
D  Cross-functional hours per consideration          [VERIFY] — model 3–6 h
E  Calendar days added to the submission clock       [VERIFY] — model 5–15 days

Annual effort  =  A × B × C × D                       hours
Preventable share (Tier 1 + Tier 2 categories)        model 40%–60%
Effort avoided =  Annual effort × Preventable share × tool effectiveness
```

Present it as a range with a slider, not a single number. Then show the *second-order* value that is harder to argue with and cannot be dismissed as an estimate:

- **Lapse avoidance** — a missed validation clock invalidates the application in every MSC. Even one avoided lapse per year is a large, concrete saving.
- **First-time-right rate** — the metric regulatory teams actually manage against.
- **Onboarding time** — a new affiliate colleague inherits institutional memory instead of rediscovering it.
- **Organisational learning** — the analytics dashboard turns 650 individual submissions into a feedback loop into submission templates and SOPs.

## 9. Vocabulary discipline

Say **consideration**, not "comment". Say **request for information**, not "query". Say **Member State Concerned**, not "country". Say **sponsor response**, not "reply". Say **validation** and **assessment** as distinct phases. Say **substantial modification**, never "amendment" (that is the old Directive term — using it signals you learned the domain from pre-2022 material).

## 10. Sources to read and cite

- Regulation (EU) No 536/2014, in particular Articles 5–8 (initial application) and 16–19 (substantial modification)
- EMA CTIS Sponsor Handbook
- EMA CTIS training materials and Q&A
- The EU CTR Q&A document maintained by the European Commission
- National competent authority pages for fee schedules (e.g. AIFA for the Italian ISTAT fee)

**Assign one team member to read the CTIS Sponsor Handbook properly in Week 1** and to resolve every **[VERIFY]** tag in this document. Cite sources in the report — it demonstrates rigour and it is cheap to do.
