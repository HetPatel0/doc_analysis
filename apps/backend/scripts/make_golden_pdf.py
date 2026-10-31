"""Generate the golden RAG fixture PDF.

Run from `apps/backend`:

    .venv/bin/python scripts/make_golden_pdf.py

The output (`tests/fixtures/nimbus-notes.pdf`) is committed so the eval harness
does not need a PDF toolchain. Page numbers match `tests/fixtures/golden_qa.json`.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tests"))

from pdf_factory import build_pdf

PAGES: list[str] = [
    # 1
    "Nimbus Notes is a note-taking application built by Wren Labs, a company "
    "founded in 2019 in Pune, India. The product stores every note as a plain "
    "Markdown file so users can export their entire library at any time without "
    "losing formatting. Wren Labs currently employs 42 people across product, "
    "engineering, and support.",
    # 2
    "Pricing. The Starter plan costs 9 USD per month and includes 5 gigabytes of "
    "storage and unlimited notes. The Team plan costs 29 USD per user per month "
    "and adds shared workspaces, version history for 12 months, and priority "
    "support. Annual billing gives two months free on either plan.",
    # 3
    "Support and refunds. Support is available Monday to Friday from 9 AM to 6 PM "
    "India Standard Time. Refunds are issued within 14 days of purchase, no "
    "questions asked. Customers can reach support at support@nimbusnotes.example "
    "or through the in-app help panel.",
    # 4
    "Security. All notes are encrypted at rest with AES-256 and every connection "
    "uses TLS 1.3. Nimbus Notes completed SOC 2 Type II certification in 2024. "
    "Two-factor authentication supports authenticator apps and hardware keys. "
    "Workspace admins can enforce single sign-on with SAML.",
    # 5
    "Mobile apps. The iOS app requires iOS 15 or newer and the Android app "
    "requires Android 10 or newer. Both apps support offline editing and sync "
    "changes when connectivity returns. The local cache is capped at 200 MB and "
    "can be cleared from settings.",
    # 6
    "Integrations. Nimbus Notes connects to Slack for daily digests, imports "
    "from Notion and Evernote, and links pull requests through GitHub. Zapier "
    "triggers and actions are available on the Team plan. Outgoing webhooks are "
    "retried three times with exponential backoff.",
    # 7
    "Developer API. The REST API uses OAuth2 for workspace installs and personal "
    "API keys for scripts. The default rate limit is 120 requests per minute per "
    "token. API keys must be rotated every 90 days. Responses are paginated with "
    "a cursor and a maximum page size of 100 records.",
    # 8
    "Changelog. Version 3.2 added tables and callouts. Version 3.3 introduced "
    "full-text search with filters by tag and date. Version 4.0 shipped in March "
    "2025 with a rewritten editor and faster sync. Version 4.1 added offline "
    "conflict resolution.",
    # 9
    "Limits. A single note may not exceed 2 MB of text. Each account can create "
    "up to 50 workspaces. A workspace supports 10,000 notes and 500 tags. "
    "Attachments count toward the plan storage quota and are capped at 25 MB per "
    "file.",
    # 10
    "Data retention. Deleted notes stay recoverable from the trash for 30 days. "
    "Encrypted backups are retained for 35 days. Users can request a full export "
    "as a zip archive containing Markdown files and attachments. Account deletion "
    "removes data within 30 days of confirmation.",
]


def main() -> None:
    out = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "nimbus-notes.pdf"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(build_pdf(PAGES))
    print(f"wrote {out} ({out.stat().st_size} bytes, {len(PAGES)} pages)")


if __name__ == "__main__":
    main()
