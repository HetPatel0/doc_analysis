"""Single-page URL import with an SSRF guard.

Only ``http(s)`` URLs that resolve to public addresses are fetched. Redirects
are followed manually (each hop is re-validated), responses are streamed with a
byte cap, and only HTML/plain-text content is accepted. Article text is
extracted with trafilatura, with a small stdlib HTML fallback.
"""

from __future__ import annotations

import ipaddress
import logging
import re
import socket
from dataclasses import dataclass
from html import unescape
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse

import requests
import trafilatura

from app.config import settings

logger = logging.getLogger(__name__)

_ALLOWED_SCHEMES = frozenset({"http", "https"})
_ALLOWED_CONTENT_TYPES = (
    "text/html",
    "application/xhtml+xml",
    "text/plain",
    "text/markdown",
    "text/x-markdown",
)
_TEXT_CONTENT_TYPES = frozenset({"text/plain", "text/markdown", "text/x-markdown"})
_REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})
_USER_AGENT = "BookifyBot/1.0 (+https://bookify.app; URL import)"
_MIN_TEXT_CHARS = 40


class UrlImportError(Exception):
    """A URL could not be imported; ``status_code`` is API-facing."""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True)
class UrlImportResult:
    text: str
    title: str | None
    final_url: str
    content_type: str


def _blocked_ip(value: str) -> bool:
    """True for private, loopback, link-local, metadata and reserved addresses."""
    address = value.split("%", 1)[0]
    try:
        parsed = ipaddress.ip_address(address)
    except ValueError:
        return True

    if parsed.version == 6 and parsed.ipv4_mapped is not None:
        return _blocked_ip(str(parsed.ipv4_mapped))

    return not parsed.is_global


def _resolve(host: str, port: int) -> list[str]:
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except (socket.gaierror, UnicodeError) as exc:
        raise UrlImportError("Could not resolve that URL.") from exc

    addresses = [info[4][0] for info in infos]
    if not addresses:
        raise UrlImportError("Could not resolve that URL.")
    return addresses


def validate_url(url: str) -> str:
    """Validate scheme/host and every resolved address before fetching."""
    candidate = (url or "").strip()
    if not candidate:
        raise UrlImportError("Enter a URL to import.")

    try:
        parsed = urlparse(candidate)
    except ValueError as exc:
        raise UrlImportError("That URL is not valid.") from exc

    if parsed.scheme.lower() not in _ALLOWED_SCHEMES:
        raise UrlImportError("Only http:// and https:// URLs can be imported.")
    if not parsed.hostname:
        raise UrlImportError("That URL is not valid.")
    if parsed.username or parsed.password:
        raise UrlImportError("URLs with credentials are not supported.")

    try:
        port = parsed.port or (443 if parsed.scheme.lower() == "https" else 80)
    except ValueError as exc:
        raise UrlImportError("That URL has an invalid port.") from exc

    host = parsed.hostname
    try:
        literal = ipaddress.ip_address(host.split("%", 1)[0])
    except ValueError:
        literal = None
    if literal is not None and _blocked_ip(str(literal)):
        raise UrlImportError("That URL points to a private or reserved address.")

    for address in _resolve(host, port):
        if _blocked_ip(address):
            raise UrlImportError("That URL points to a private or reserved address.")

    return candidate


def import_url(url: str) -> UrlImportResult:
    """Fetch one page, extract its readable text, and return it."""
    if not settings.url_import_enabled:
        raise UrlImportError("URL import is disabled.", status_code=403)

    current = validate_url(url)
    max_redirects = max(0, settings.url_import_max_redirects)

    for _ in range(max_redirects + 1):
        current = validate_url(current)
        try:
            response = requests.get(
                current,
                allow_redirects=False,
                stream=True,
                timeout=(
                    min(5.0, settings.url_import_timeout_seconds),
                    settings.url_import_timeout_seconds,
                ),
                headers={
                    "User-Agent": _USER_AGENT,
                    "Accept": "text/html,application/xhtml+xml,text/plain;q=0.8",
                },
            )
        except requests.RequestException as exc:
            logger.info("url import fetch failed for %s: %s", current, exc)
            raise UrlImportError("Could not fetch that URL.", status_code=502) from exc

        with response:
            if response.status_code in _REDIRECT_STATUSES:
                location = response.headers.get("location")
                if not location:
                    raise UrlImportError("The URL redirect was invalid.")
                current = urljoin(current, location)
                continue

            if response.status_code >= 400:
                raise UrlImportError(
                    f"The URL returned HTTP {response.status_code}.",
                    status_code=400,
                )

            content_type = (
                (response.headers.get("content-type") or "")
                .split(";")[0]
                .strip()
                .lower()
            )
            if content_type and not any(
                content_type.startswith(allowed) for allowed in _ALLOWED_CONTENT_TYPES
            ):
                raise UrlImportError(
                    "That URL is not a webpage or text document.",
                    status_code=415,
                )

            body = _read_capped(response, settings.url_import_max_mb * 1024 * 1024)
            raw = _decode_body(body, content_type, response.headers.get("content-type"))
            break
    else:
        raise UrlImportError("That URL redirects too many times.")

    final_url = current
    text, title = _extract(raw, content_type, final_url)
    if len(text) < _MIN_TEXT_CHARS:
        raise UrlImportError(
            "That page did not contain enough readable text.",
            status_code=422,
        )

    return UrlImportResult(
        text=text,
        title=title,
        final_url=final_url,
        content_type=content_type or "text/html",
    )


def _read_capped(response: requests.Response, max_bytes: int) -> bytes:
    body = bytearray()
    for chunk in response.iter_content(chunk_size=64 * 1024):
        if not chunk:
            continue
        body.extend(chunk)
        if len(body) > max_bytes:
            raise UrlImportError("That page is too large to import.", status_code=413)
    return bytes(body)


def _decode_body(body: bytes, content_type: str, raw_header: str | None) -> str:
    if "\x00" in body[:4096].decode("latin-1", errors="ignore"):
        raise UrlImportError("That URL did not return readable text.", status_code=415)

    try:
        return body.decode("utf-8")
    except UnicodeDecodeError:
        pass

    charset = None
    if raw_header and "charset=" in raw_header.lower():
        charset = raw_header.lower().split("charset=", 1)[1].split(";")[0].strip()
    if charset and charset not in {"iso-8859-1", "latin-1"}:
        try:
            return body.decode(charset)
        except (UnicodeDecodeError, LookupError):
            pass

    return body.decode("latin-1")


def _extract(raw: str, content_type: str, final_url: str) -> tuple[str, str | None]:
    title = _html_title(raw)
    if content_type in _TEXT_CONTENT_TYPES:
        return raw.strip(), title or _title_from_url(final_url)

    try:
        extracted = trafilatura.extract(
            raw,
            url=final_url,
            include_comments=False,
            include_tables=True,
            favor_recall=True,
        )
    except Exception as exc:  # trafilatura can raise on unusual markup
        logger.info("trafilatura failed for %s: %s", final_url, exc)
        extracted = None

    text = (extracted or "").strip()
    if not text:
        text = _html_fallback(raw)

    return text, title or _title_from_url(final_url)


class _TextExtractor(HTMLParser):
    """Last-resort HTML-to-text: drop scripts/styles and collapse whitespace."""

    _SKIP = frozenset({"script", "style", "noscript", "svg", "template"})

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._skip_depth = 0
        self._parts: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag in self._SKIP:
            self._skip_depth += 1
        elif tag in {"p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4"}:
            self._parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in self._SKIP and self._skip_depth:
            self._skip_depth -= 1

    def handle_data(self, data: str) -> None:
        if not self._skip_depth:
            self._parts.append(data)

    def text(self) -> str:
        joined = unescape("".join(self._parts))
        lines = [" ".join(line.split()) for line in joined.splitlines()]
        blocks: list[str] = []
        previous_blank = True
        for line in lines:
            if not line:
                if not previous_blank:
                    blocks.append("")
                previous_blank = True
                continue
            blocks.append(line)
            previous_blank = False
        return "\n".join(blocks).strip()


def _html_fallback(raw: str) -> str:
    parser = _TextExtractor()
    try:
        parser.feed(raw)
        return parser.text()
    except Exception:
        return re.sub(r"<[^>]+>", " ", raw).strip()


def _html_title(raw: str) -> str | None:
    match = re.search(r"<title[^>]*>([\s\S]*?)</title>", raw, re.IGNORECASE)
    if not match:
        return None
    title = " ".join(unescape(match.group(1)).split())
    return title[:200] or None


def _title_from_url(url: str) -> str:
    parsed = urlparse(url)
    slug = parsed.path.rstrip("/").rsplit("/", 1)[-1]
    slug = re.sub(r"[-_]+", " ", slug)
    slug = re.sub(r"\.[A-Za-z0-9]+$", "", slug).strip()
    return slug or parsed.netloc or "Imported page"
