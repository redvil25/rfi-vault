"""
Three CTIS-shaped requests, one per path Suggestions can take.

  consideration-only   no sponsor response  -> three options
  answered-well        a response that matches accepted precedent -> ADEQUATE
  answered-badly       a response that supplies nothing -> IMPROVE

Regenerate with `npm run fixtures:suggest`.
"""
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer

CONSIDERATION = (
    "IT - No payment receipt has been identified for this submission. Please submit the "
    "proof of payment together with the reference number used for the transfer."
)

CASES = {
    "consideration-only": None,
    "answered-well": (
        "The bank transfer receipt referencing POL417283 has been uploaded in section "
        "Proof of payment."
    ),
    "answered-badly": "Noted. We will look into this and revert in due course.",
}


def build(name: str, response: str | None) -> None:
    styles = getSampleStyleSheet()
    doc = SimpleDocTemplate(f"fixtures/rfi-{name}.pdf", pagesize=A4, title=name)
    flow = [
        Paragraph("2024-519530-24-00 SUBSTANTIAL MODIFICATION", styles["Heading3"]),
        Paragraph("CT-2024-519530-24-00-SM06-001 - Requests for information", styles["Heading3"]),
        Spacer(1, 14),
        Paragraph("Consideration number:", styles["Heading4"]),
        Paragraph("1", styles["BodyText"]),
        Paragraph("Application section parts", styles["Heading4"]),
        Paragraph("Part I - Regulatory", styles["BodyText"]),
        Paragraph("Consideration:", styles["Heading4"]),
        Paragraph(CONSIDERATION, styles["BodyText"]),
    ]
    if response:
        flow += [
            Paragraph("Sponsor response:", styles["Heading4"]),
            Paragraph(response, styles["BodyText"]),
        ]
    doc.build(flow)
    print(f"Wrote fixtures/rfi-{name}.pdf")


if __name__ == "__main__":
    for name, response in CASES.items():
        build(name, response)
