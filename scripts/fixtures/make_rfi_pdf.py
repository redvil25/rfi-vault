"""
Generates a CTIS-style "Requests for information" PDF fixture.

The layout mirrors the real export supplied with the problem statement: a page
header carrying the trial number, submission type, document reference and
timestamp, then one bordered block per consideration with fixed field labels.

This is the fixture the ingestion parser is tested against. It deliberately
includes the awkward cases:

  - a Member-State-prefixed consideration ("IT - ...") and one with no prefix
  - a consideration with no sponsor response yet (still open)
  - multi-paragraph consideration text, including a URL
  - "Application section parts" written WITHOUT a trailing colon, exactly as in
    the real document, while every other label has one
  - a block that spans a page break

Regenerate:  python scripts/fixtures/make_rfi_pdf.py
"""

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.platypus import (
    BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, Table, TableStyle,
)

TRIAL = "2024-519530-24-00"
DOC_REF = "CT-2024-519530-24-00-SM06-001"
SUBMISSION_TYPE = "SUBSTANTIAL MODIFICATION"
STAMP = "05/08/2026 12:53"
OUT = "fixtures/rfi-example-ctis.pdf"

LABEL = ParagraphStyle(
    "label", fontName="Helvetica-Bold", fontSize=9.5, leading=13,
    spaceBefore=6, spaceAfter=1,
)
VALUE = ParagraphStyle(
    "value", fontName="Helvetica", fontSize=9.5, leading=13, spaceAfter=2,
)
HEADER = ParagraphStyle(
    "header", fontName="Helvetica", fontSize=8, leading=10,
    textColor=colors.HexColor("#333333"),
)

CONSIDERATIONS = [
    {
        "number": "1",
        "parts": "Part I - Regulatory",
        "document": "Cover letter",
        "consideration": [
            "IT - Please upload the proof of payment of the additional amount required by law "
            "for all applications submitted starting from 17 February 2025 due to ISTAT updated "
            "fee. For your reference: https://www.aifa.gov.it/en/-/adeguamento-delle-tariffe-di-"
            "cui-al-decreto-del-ministro-della-salute-30/01/2023 (attached 1). You can find the "
            "additional amount to be paid in the same POL number you have already provided for "
            "this submission.",
        ],
        "response": "Proof of payment of the additional amount required is provided.",
    },
    {
        "number": "2",
        "parts": "Part II - Informed consent",
        "document": "Informed consent form and subject information sheet",
        "consideration": [
            "ES - The informed consent form submitted for site ES-119 is provided in English only.",
            "A Spanish version of the informed consent form and the subject information sheet is "
            "required for all participating sites in Spain. Please upload the local language "
            "version and confirm that it is consistent with the English source version 3.0.",
        ],
        "response": "The Spanish version of the informed consent form, version 3.0 dated "
                    "14/03/2026, is provided for site ES-119.",
    },
    {
        "number": "3",
        "parts": "Part I - IMPD Quality",
        "document": "IMPD Quality section 3.2.P.8",
        "consideration": [
            "The stability data provided for the investigational medicinal product do not cover "
            "the proposed shelf life of 36 months. Please provide supporting stability data or "
            "revise the proposed shelf life accordingly.",
        ],
        # Still open — no sponsor response recorded yet.
        "response": None,
    },
    {
        "number": "4",
        "parts": "Part II - Recruitment arrangements",
        "document": "Subject recruitment material",
        "consideration": [
            "PL - The recruitment material referred to in section 9.4 of the protocol has not "
            "been submitted for assessment.",
            "Please upload all subject-facing advertisements intended for use in Poland, "
            "together with a Polish translation of each document.",
        ],
        "response": "All recruitment material intended for use in Poland is provided, together "
                    "with the Polish translations.",
    },
    {
        "number": "5",
        "parts": "Part I - Regulatory",
        "document": "QP declaration",
        "consideration": [
            "The QP declaration submitted does not cover the manufacturing site DE-088. "
            "Please provide a declaration covering all manufacturing sites listed in the "
            "application form.",
        ],
        "response": "A QP declaration covering manufacturing site DE-088 is provided.",
    },
]


def page_header(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#333333"))
    y = A4[1] - 18 * mm
    canvas.drawString(20 * mm, y, TRIAL)
    canvas.drawString(62 * mm, y, SUBMISSION_TYPE)
    canvas.drawString(105 * mm, y, f"{DOC_REF} - Requests for information")
    canvas.drawRightString(A4[0] - 20 * mm, y, STAMP)
    canvas.restoreState()


def block(item):
    """One bordered consideration block."""
    inner = [Paragraph("Consideration number:", LABEL), Paragraph(item["number"], VALUE)]

    # NOTE: no colon after "parts", matching the real document.
    inner += [Paragraph("Application section parts", LABEL), Paragraph(item["parts"], VALUE)]
    inner += [
        Paragraph("Application section and document:", LABEL),
        Paragraph(item["document"], VALUE),
    ]

    inner.append(Paragraph("Consideration:", LABEL))
    for para in item["consideration"]:
        inner.append(Paragraph(para, VALUE))

    inner.append(Paragraph("Sponsor response:", LABEL))
    inner.append(Paragraph(item["response"] or "", VALUE))

    table = Table([[inner]], colWidths=[168 * mm])
    table.setStyle(
        TableStyle([
            ("BOX", (0, 0), (-1, -1), 0.75, colors.HexColor("#222222")),
            ("LEFTPADDING", (0, 0), (-1, -1), 10),
            ("RIGHTPADDING", (0, 0), (-1, -1), 10),
            ("TOPPADDING", (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ])
    )
    return table


def main():
    doc = BaseDocTemplate(
        OUT, pagesize=A4,
        leftMargin=20 * mm, rightMargin=20 * mm,
        topMargin=28 * mm, bottomMargin=18 * mm,
        title=f"{DOC_REF} - Requests for information",
        author="CTIS",
    )
    frame = Frame(
        doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="body"
    )
    doc.addPageTemplates([PageTemplate(id="main", frames=[frame], onPage=page_header)])

    story = []
    for item in CONSIDERATIONS:
        story.append(block(item))
        story.append(Spacer(1, 8 * mm))

    doc.build(story)
    print(f"wrote {OUT} with {len(CONSIDERATIONS)} considerations")


if __name__ == "__main__":
    main()
