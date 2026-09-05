"""
A synthetic clinical report, for exercising the Clinical Report Check.

Deliberately imperfect, and each flaw is one the check is supposed to find:
  * an admitted gap        "has not yet been returned and is not attached"
  * a promise              "will be provided once"
  * a placeholder          "POLXXXXX"
  * a cross-section clash  protocol version 4.0 vs 3.0, 320 subjects vs 280
  * an unmentioned theme   nothing about the local-language consent

Regenerate with `npm run fixtures:report`.
"""
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer

SECTIONS = [
    ("Cover Letter", [
        "This substantial modification for trial 2024-519530-24-00 concerns Protocol version 4.0 "
        "dated 2026-01-15 for NN-1234. Approximately 320 subjects will be enrolled across 40 sites.",
        "The signed cover letter has not yet been returned and is not attached. It will be provided "
        "once the sponsor legal representative completes the signature.",
    ]),
    ("Regulatory", [
        "The application is submitted under Regulation (EU) No 536/2014. The sponsor confirms that "
        "the dossier is complete and that contact details are given in the application form.",
        "Payment was arranged by the local affiliate. POL reference: POLXXXXX.",
    ]),
    ("Protocol", [
        "Protocol v3.0, dated 2025-11-02. A total of 280 patients will be randomised in a 1:1 ratio. "
        "NN-1234 5 mg is administered once weekly for 52 weeks.",
        "The schedule of assessments describes visits at screening, baseline, and every 12 weeks.",
    ]),
    ("Informed Consent", [
        "The informed consent form has been updated to reflect the revised schedule of assessments. "
        "It describes the purpose of the trial, the foreseeable risks, and the right to withdraw.",
    ]),
]

def main() -> None:
    styles = getSampleStyleSheet()
    doc = SimpleDocTemplate("fixtures/clinical-report-example.pdf", pagesize=A4, title="Clinical report")
    flow = [Paragraph("Report for the RFI Application", styles["Title"]),
            Paragraph("Efficacy and safety of NN-1234 in type 2 diabetes", styles["Heading2"]),
            Spacer(1, 18)]
    for heading, paragraphs in SECTIONS:
        flow.append(Paragraph(heading, styles["Heading1"]))
        for text in paragraphs:
            flow.append(Paragraph(text, styles["BodyText"]))
        flow.append(Spacer(1, 12))
    doc.build(flow)
    print("Wrote fixtures/clinical-report-example.pdf")

if __name__ == "__main__":
    main()
