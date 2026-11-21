"""Generate the real-world RAG eval fixtures.

Run from `apps/backend`:

    .venv/bin/python scripts/make_realworld_fixtures.py

The generated files under `tests/fixtures/realworld/` are committed so the eval
does not need Ghostscript or python-docx at runtime. The scanned PDF is built as
a normal text PDF and then rasterized with Ghostscript, which removes the text
layer so the OCR fallback is exercised for real.

`dataset.json` and the `*_qa.json` files are hand-written next to the fixtures;
this script only regenerates the binary/text documents.
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT / "tests"))

from pdf_factory import build_pdf  # noqa: E402

OUTPUT_DIR = BACKEND_ROOT / "tests" / "fixtures" / "realworld"

SCAN_PAGES: list[list[str]] = [
    [
        "ORCHID SUPPORT HANDBOOK",
        "REFUND POLICY",
        "",
        "Refunds are issued within 21 days of purchase.",
        "The refund is returned to the original payment method",
        "within 5 business days.",
        "",
        "Contact billing@orchid.example for refund questions.",
    ],
    [
        "ORCHID SUPPORT HANDBOOK",
        "SUPPORT HOURS",
        "",
        "Support is available Monday through Saturday from",
        "8 AM to 8 PM Central European Time.",
        "",
        "Emergency incidents are handled 24 hours a day,",
        "7 days a week.",
    ],
    [
        "ORCHID SUPPORT HANDBOOK",
        "ESCALATION",
        "",
        "A ticket that receives no response for 48 hours is",
        "escalated to the duty manager.",
        "",
        "The duty manager can be reached at duty@orchid.example.",
    ],
]

REPORT_PAGES: list[list[str]] = [
    [
        "NORTHWIND QUARTERLY REPORT",
        "Q3 2026",
        "",
        "Revenue",
        "Q3 revenue was 4.8 million EUR, up 12 percent",
        "year over year. Growth was driven by renewals.",
        "",
        "Region      Revenue     Growth",
        "EMEA        2.1M EUR    +9%",
        "APAC        1.4M EUR    +18%",
        "Americas    1.3M EUR    +11%",
        "",
        "Footnote: figures are unaudited.",
    ],
    [
        "NORTHWIND QUARTERLY REPORT",
        "Q3 2026",
        "",
        "Customers",
        "Customer churn fell to 3.4 percent in Q3.",
        "Net revenue retention was 108 percent.",
        "The enterprise segment added 14 new logos.",
        "",
        "Support",
        "Median first response time was 42 minutes.",
        "Customer satisfaction was 4.6 out of 5.",
    ],
    [
        "NORTHWIND QUARTERLY REPORT",
        "Q3 2026",
        "",
        "People",
        "Headcount reached 84 employees at the end of Q3.",
        "Engineering accounts for 31 employees.",
        "The company opened a second office in Lisbon.",
        "",
        "Security",
        "All employees completed security training in September.",
        "Two-factor authentication is mandatory.",
    ],
]

DOCX_SECTIONS: list[tuple[str, str]] = [
    (
        "Eligibility",
        "All full-time employees may work remotely up to three days per week. "
        "Managers may approve additional remote days for individual teams.",
    ),
    (
        "Equipment",
        "Each new remote employee receives a one-time equipment stipend of 750 "
        "USD. The stipend covers a monitor, chair, and desk.",
    ),
    (
        "Core hours",
        "Core collaboration hours are 10:00 to 15:00 Central European Time. "
        "Outside core hours, schedules are flexible.",
    ),
    (
        "Security",
        "Remote employees must use the company VPN and a hardware security key "
        "for all production systems. Personal devices are not permitted.",
    ),
    (
        "Travel",
        "Remote employees visit the office twice per year; travel is reimbursed.",
    ),
]

DOCX_ALLOWANCES: list[tuple[str, str]] = [
    ("Equipment", "750 USD"),
    ("Internet", "40 USD per month"),
    ("Coworking", "200 USD per month"),
]

PRICING_TEXT = """Helio Pricing
Starter: 12 USD per month, includes 3 projects and 10 GB storage.
Growth: 39 USD per month, includes unlimited projects and 100 GB storage.
Enterprise: custom pricing with SSO and audit logs.
Every plan starts with a 14-day free trial.
Annual billing saves 20 percent.
"""


def write_text_pdf(path: Path, pages: list[list[str]]) -> None:
    path.write_bytes(build_pdf(pages))


def rasterize_pdf(source: Path, destination: Path) -> None:
    """Render each page to a bitmap PDF, dropping the text layer."""
    subprocess.run(
        [
            "gs",
            "-q",
            "-dNOPAUSE",
            "-dBATCH",
            "-dSAFER",
            "-sDEVICE=pdfimage24",
            "-r200",
            "-dDownsampleColorImages=false",
            f"-sOutputFile={destination}",
            str(source),
        ],
        check=True,
    )


def write_docx(path: Path) -> None:
    from docx import Document as DocxDocument

    document = DocxDocument()
    document.add_heading("Acme Remote Work Policy", level=0)
    document.add_paragraph(
        "This policy applies to all full-time employees at Acme."
    )

    for heading, body in DOCX_SECTIONS:
        document.add_heading(heading, level=1)
        document.add_paragraph(body)

    document.add_heading("Allowances", level=1)
    table = document.add_table(rows=1, cols=2)
    table.style = "Table Grid"
    header = table.rows[0].cells
    header[0].text = "Allowance"
    header[1].text = "Amount"
    for name, amount in DOCX_ALLOWANCES:
        row = table.add_row().cells
        row[0].text = name
        row[1].text = amount

    document.save(str(path))


def main() -> int:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="bookify-realworld-") as tmp:
        scan_source = Path(tmp) / "scan-refunds-text.pdf"
        write_text_pdf(scan_source, SCAN_PAGES)
        rasterize_pdf(scan_source, OUTPUT_DIR / "scan-refunds.pdf")

    write_text_pdf(OUTPUT_DIR / "messy-report.pdf", REPORT_PAGES)
    write_docx(OUTPUT_DIR / "policy.docx")
    (OUTPUT_DIR / "pricing.txt").write_text(PRICING_TEXT, encoding="utf-8")

    for name in ("scan-refunds.pdf", "messy-report.pdf", "policy.docx", "pricing.txt"):
        path = OUTPUT_DIR / name
        print(f"{path.relative_to(BACKEND_ROOT)}  {path.stat().st_size} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
