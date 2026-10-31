"""Tiny dependency-free PDF writer for test fixtures.

Produces a valid, text-layer PDF (Helvetica, letter size) so tests and the RAG
eval harness can create realistic documents without binary fixtures or a
heavy PDF library.
"""

from __future__ import annotations

from textwrap import wrap

PAGE_WIDTH = 612
PAGE_HEIGHT = 792
FONT_SIZE = 11
LINE_HEIGHT = 14
MARGIN = 72
WRAP_AT = 88


def _escape(text: str) -> str:
    return text.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")


def _page_stream(lines: list[str]) -> bytes:
    body = ["BT", f"/F1 {FONT_SIZE} Tf", f"{MARGIN} {PAGE_HEIGHT - MARGIN} Td"]
    first = True
    for line in lines:
        if not first:
            body.append(f"0 -{LINE_HEIGHT} Td")
        body.append(f"({_escape(line)}) Tj")
        first = False
    body.append("ET")
    return "\n".join(body).encode("latin-1")


def build_pdf(pages: list[str | list[str]]) -> bytes:
    """Build a PDF from page text. Strings are wrapped, lists are used as-is."""
    page_lines: list[list[str]] = []
    for page in pages:
        raw = wrap(page, width=WRAP_AT) if isinstance(page, str) else list(page)
        page_lines.append(raw or [""])

    objects: list[bytes] = []

    def add(payload: bytes) -> int:
        objects.append(payload)
        return len(objects)

    catalog_id = add(b"")  # placeholder, filled after kids are known
    pages_id = add(b"")
    font_id = add(
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
    )

    kids: list[int] = []
    for lines in page_lines:
        stream = _page_stream(lines)
        content_id = add(
            b"<< /Length %d >>\nstream\n%s\nendstream" % (len(stream), stream)
        )
        page_id = add(
            (
                f"<< /Type /Page /Parent {pages_id} 0 R "
                f"/MediaBox [0 0 {PAGE_WIDTH} {PAGE_HEIGHT}] "
                f"/Resources << /Font << /F1 {font_id} 0 R >> >> "
                f"/Contents {content_id} 0 R >>"
            ).encode("latin-1")
        )
        kids.append(page_id)

    objects[catalog_id - 1] = f"<< /Type /Catalog /Pages {pages_id} 0 R >>".encode(
        "latin-1"
    )
    kid_refs = " ".join(f"{kid} 0 R" for kid in kids)
    objects[pages_id - 1] = (
        f"<< /Type /Pages /Kids [{kid_refs}] /Count {len(kids)} >>"
    ).encode("latin-1")

    out = bytearray(b"%PDF-1.4\n")
    offsets: list[int] = []
    for number, payload in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n".encode("latin-1") + payload + b"\nendobj\n"

    xref_at = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode("latin-1")
    out += b"0000000000 65535 f \n"
    for offset in offsets:
        out += f"{offset:010d} 00000 n \n".encode("latin-1")
    out += (
        f"trailer\n<< /Size {len(objects) + 1} /Root {catalog_id} 0 R >>\n"
        f"startxref\n{xref_at}\n%%EOF\n"
    ).encode("latin-1")

    return bytes(out)


def build_scanned_pdf(page_count: int = 2) -> bytes:
    """A PDF whose pages have no text layer (blank pages, like a scan)."""
    return build_pdf([[" "] for _ in range(page_count)])
