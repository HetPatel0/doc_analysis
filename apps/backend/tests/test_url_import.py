"""Offline tests for the URL import SSRF guard and extraction path."""

from __future__ import annotations

import pytest
import requests
from app.config import settings
from app.services import url_import


class FakeResponse:
    def __init__(
        self,
        status_code: int = 200,
        *,
        headers: dict[str, str] | None = None,
        body: bytes = b"",
    ) -> None:
        self.status_code = status_code
        self.headers = headers or {}
        self._body = body

    def __enter__(self):
        return self

    def __exit__(self, *args) -> None:
        return None

    def iter_content(self, chunk_size: int = 64 * 1024):
        for start in range(0, len(self._body), chunk_size):
            yield self._body[start : start + chunk_size]


@pytest.fixture(autouse=True)
def public_dns(monkeypatch):
    monkeypatch.setattr(url_import, "_resolve", lambda host, port: ["93.184.216.34"])
    monkeypatch.setattr(settings, "url_import_enabled", True)
    monkeypatch.setattr(settings, "url_import_max_mb", 5)


@pytest.mark.parametrize(
    "address",
    [
        "127.0.0.1",
        "10.0.0.5",
        "172.16.4.4",
        "192.168.1.1",
        "169.254.169.254",
        "0.0.0.0",
        "::1",
        "fd00::1",
        "fe80::1",
    ],
)
def test_blocked_ip_rejects_internal_ranges(address):
    assert url_import._blocked_ip(address) is True


@pytest.mark.parametrize("address", ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])
def test_blocked_ip_allows_public_addresses(address):
    assert url_import._blocked_ip(address) is False


@pytest.mark.parametrize(
    "url,message",
    [
        ("ftp://example.com/file", "http:// and https://"),
        ("file:///etc/passwd", "http:// and https://"),
        ("https://user:pass@example.com/", "credentials"),
        ("https://", "not valid"),
        ("http://127.0.0.1/secret", "private or reserved"),
        ("http://169.254.169.254/latest/meta-data", "private or reserved"),
        ("http://[::1]/", "private or reserved"),
    ],
)
def test_validate_url_rejects_unsafe_targets(url, message):
    with pytest.raises(url_import.UrlImportError, match=message):
        url_import.validate_url(url)


def test_validate_url_rejects_private_dns_answer(monkeypatch):
    monkeypatch.setattr(url_import, "_resolve", lambda host, port: ["10.1.2.3"])

    with pytest.raises(url_import.UrlImportError, match="private or reserved"):
        url_import.validate_url("https://intranet.example/article")


def test_import_url_extracts_plain_text(monkeypatch):
    monkeypatch.setattr(
        url_import.requests,
        "get",
        lambda *args, **kwargs: FakeResponse(
            headers={"content-type": "text/plain; charset=utf-8"},
            body=b"One useful sentence. " * 4,
        ),
    )

    result = url_import.import_url("https://example.com/notes.txt")

    assert result.final_url == "https://example.com/notes.txt"
    assert result.content_type == "text/plain"
    assert result.text.startswith("One useful sentence.")
    assert result.title == "notes"


def test_import_url_follows_redirects_and_revalidates(monkeypatch):
    calls: list[str] = []

    def fake_get(url, **kwargs):
        calls.append(url)
        if url == "https://example.com/start":
            return FakeResponse(302, headers={"location": "/final"})
        return FakeResponse(
            headers={"content-type": "text/plain"},
            body=b"Final page body. " * 4,
        )

    monkeypatch.setattr(url_import.requests, "get", fake_get)

    result = url_import.import_url("https://example.com/start")

    assert result.final_url == "https://example.com/final"
    assert calls == ["https://example.com/start", "https://example.com/final"]


def test_import_url_rejects_redirect_to_private_host(monkeypatch):
    monkeypatch.setattr(
        url_import.requests,
        "get",
        lambda url, **kwargs: FakeResponse(
            302, headers={"location": "http://127.0.0.1/admin"}
        ),
    )

    with pytest.raises(url_import.UrlImportError, match="private or reserved"):
        url_import.import_url("https://example.com/start")


def test_import_url_rejects_too_many_redirects(monkeypatch):
    monkeypatch.setattr(
        url_import.requests,
        "get",
        lambda url, **kwargs: FakeResponse(
            302, headers={"location": "https://example.com/again"}
        ),
    )
    monkeypatch.setattr(settings, "url_import_max_redirects", 1)

    with pytest.raises(url_import.UrlImportError, match="too many"):
        url_import.import_url("https://example.com/start")


def test_import_url_rejects_non_text_content_type(monkeypatch):
    monkeypatch.setattr(
        url_import.requests,
        "get",
        lambda *args, **kwargs: FakeResponse(
            headers={"content-type": "application/pdf"}, body=b"%PDF-1.7"
        ),
    )

    with pytest.raises(url_import.UrlImportError, match="not a webpage") as exc:
        url_import.import_url("https://example.com/file.pdf")
    assert exc.value.status_code == 415


def test_import_url_rejects_oversized_pages(monkeypatch):
    monkeypatch.setattr(settings, "url_import_max_mb", 0)
    monkeypatch.setattr(
        url_import.requests,
        "get",
        lambda *args, **kwargs: FakeResponse(
            headers={"content-type": "text/plain"}, body=b"x" * 10
        ),
    )

    with pytest.raises(url_import.UrlImportError, match="too large") as exc:
        url_import.import_url("https://example.com/big")
    assert exc.value.status_code == 413


def test_import_url_wraps_network_errors(monkeypatch):
    def boom(url, **kwargs):
        raise requests.ConnectionError("refused")

    monkeypatch.setattr(url_import.requests, "get", boom)

    with pytest.raises(url_import.UrlImportError, match="Could not fetch") as exc:
        url_import.import_url("https://example.com/down")
    assert exc.value.status_code == 502


def test_import_url_falls_back_to_html_text(monkeypatch):
    monkeypatch.setattr(url_import.trafilatura, "extract", lambda *a, **k: None)
    html = (
        b"<html><head><title>Fallback page</title></head><body>"
        b"<script>ignore()</script><p>Readable paragraph text for the fallback "
        b"path.</p></body></html>"
    )
    monkeypatch.setattr(
        url_import.requests,
        "get",
        lambda *args, **kwargs: FakeResponse(
            headers={"content-type": "text/html; charset=utf-8"}, body=html
        ),
    )

    result = url_import.import_url("https://example.com/article")

    assert "Readable paragraph text" in result.text
    assert "ignore()" not in result.text
    assert result.title == "Fallback page"


def test_import_url_rejects_empty_pages(monkeypatch):
    monkeypatch.setattr(
        url_import.requests,
        "get",
        lambda *args, **kwargs: FakeResponse(
            headers={"content-type": "text/plain"}, body=b"   "
        ),
    )

    with pytest.raises(url_import.UrlImportError, match="enough readable text"):
        url_import.import_url("https://example.com/empty")


def test_import_url_respects_disable_flag(monkeypatch):
    monkeypatch.setattr(settings, "url_import_enabled", False)

    with pytest.raises(url_import.UrlImportError, match="disabled") as exc:
        url_import.import_url("https://example.com/")
    assert exc.value.status_code == 403
