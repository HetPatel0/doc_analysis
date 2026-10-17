from __future__ import annotations

from app.config import settings


def init_sentry() -> None:
    """Initialize Sentry when a DSN is configured. Safe no-op otherwise."""
    if not settings.sentry_dsn:
        return

    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.logging import LoggingIntegration
    except ImportError:
        return

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.sentry_environment,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        integrations=[
            FastApiIntegration(),
            LoggingIntegration(level=None, event_level="ERROR"),
        ],
        send_default_pii=False,
    )


def capture_exception(error: BaseException) -> None:
    """Report a handled exception to Sentry without requiring the SDK."""
    try:
        import sentry_sdk
    except ImportError:
        return

    sentry_sdk.capture_exception(error)
