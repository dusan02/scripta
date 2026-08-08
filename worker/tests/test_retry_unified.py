"""Unit testy pre unified retry logic v scrapers/base.py.

Testuje:
- retry_async dekorátor (transient vs permanent errors)
- retry_async_call helper
- ContentCheckError (SP "Server je nedostupný")
- TransientHTTPError (HTTP 5xx, 429)
- on_retry callback (FS fresh-page pattern)
- Retry metrics (attempts, retries, recoveries, exhausted, permanent_skips)
- Exponential backoff calculation
- Rate-limit multiplier (429 → 3x delay)
"""
import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock

from src.scrapers.base import (
    retry_async,
    retry_async_call,
    _is_transient_error,
    ContentCheckError,
    TransientHTTPError,
    ScraperUnavailableError,
    ScraperInputError,
    get_retry_metrics,
    reset_retry_metrics,
    log_retry_metrics,
)


class TestTransientErrorClassification:
    """Test _is_transient_error — klasifikácia transient vs permanent."""

    def test_timeout_is_transient(self):
        assert _is_transient_error(asyncio.TimeoutError()) is True

    def test_value_error_is_permanent(self):
        assert _is_transient_error(ValueError("bad")) is False

    def test_key_error_is_permanent(self):
        assert _is_transient_error(KeyError("missing")) is False

    def test_scraper_unavailable_is_transient(self):
        assert _is_transient_error(ScraperUnavailableError("down")) is True

    def test_content_check_is_transient(self):
        assert _is_transient_error(ContentCheckError("bad content")) is True

    def test_transient_http_is_transient(self):
        assert _is_transient_error(TransientHTTPError("500")) is True

    def test_cancelled_is_permanent(self):
        assert _is_transient_error(asyncio.CancelledError()) is False

    def test_scraper_input_is_permanent(self):
        assert _is_transient_error(ScraperInputError("bad")) is False


class TestRetryAsyncDecorator:
    """Test retry_async dekorátor."""

    def setup_method(self):
        reset_retry_metrics()

    @pytest.mark.asyncio
    async def test_success_first_try(self):
        calls = {'count': 0}

        @retry_async(source_type='TEST', max_attempts=3, base_delay=0.01, jitter=0)
        async def func():
            calls['count'] += 1
            return 'ok'

        result = await func()
        assert result == 'ok'
        assert calls['count'] == 1

    @pytest.mark.asyncio
    async def test_recover_on_retry(self):
        calls = {'count': 0}

        @retry_async(source_type='TEST', max_attempts=3, base_delay=0.01, jitter=0)
        async def func():
            calls['count'] += 1
            if calls['count'] < 3:
                raise asyncio.TimeoutError("timeout")
            return 'recovered'

        result = await func()
        assert result == 'recovered'
        assert calls['count'] == 3

    @pytest.mark.asyncio
    async def test_permanent_error_no_retry(self):
        calls = {'count': 0}

        @retry_async(source_type='TEST', max_attempts=3, base_delay=0.01)
        async def func():
            calls['count'] += 1
            raise ValueError("permanent")

        with pytest.raises(ValueError):
            await func()
        assert calls['count'] == 1

    @pytest.mark.asyncio
    async def test_all_attempts_exhausted(self):
        calls = {'count': 0}

        @retry_async(source_type='TEST', max_attempts=3, base_delay=0.01, jitter=0)
        async def func():
            calls['count'] += 1
            raise asyncio.TimeoutError("always")

        with pytest.raises(ScraperUnavailableError):
            await func()
        assert calls['count'] == 3

    @pytest.mark.asyncio
    async def test_exponential_backoff_delays(self):
        """Overí že delay rastie exponenciálne: 2s, 4s, 8s (base=2, jitter=0)."""
        import time
        timestamps = []

        @retry_async(source_type='TEST', max_attempts=4, base_delay=0.05, jitter=0)
        async def func():
            timestamps.append(time.monotonic())
            raise asyncio.TimeoutError()

        with pytest.raises(ScraperUnavailableError):
            await func()

        # 4 attempts, 3 sleeps: 0.05, 0.10, 0.20
        assert len(timestamps) == 4
        d1 = timestamps[1] - timestamps[0]
        d2 = timestamps[2] - timestamps[1]
        d3 = timestamps[3] - timestamps[2]
        # Allow tolerance for CI
        assert 0.04 <= d1 <= 0.08, f"Delay 1 should be ~0.05s, got {d1:.3f}s"
        assert 0.09 <= d2 <= 0.13, f"Delay 2 should be ~0.10s, got {d2:.3f}s"
        assert 0.19 <= d3 <= 0.25, f"Delay 3 should be ~0.20s, got {d3:.3f}s"


class TestContentCheckError:
    """Test ContentCheckError — SP 'Server je nedostupný' pattern."""

    def setup_method(self):
        reset_retry_metrics()

    @pytest.mark.asyncio
    async def test_content_check_returns_result_on_exhaust(self):
        """Ak ContentCheckError má result, vráti ho pri exhaust (nie raise)."""
        calls = {'count': 0}

        @retry_async(source_type='SP', max_attempts=3, base_delay=0.01, jitter=0)
        async def func():
            calls['count'] += 1
            raise ContentCheckError("Server nedostupny", result="UNAVAILABLE")

        result = await func()
        assert result == "UNAVAILABLE"
        assert calls['count'] == 3

    @pytest.mark.asyncio
    async def test_content_check_no_result_raises(self):
        """Ak ContentCheckError nemá result, raise ScraperUnavailableError."""
        @retry_async(source_type='SP', max_attempts=2, base_delay=0.01, jitter=0)
        async def func():
            raise ContentCheckError("Server nedostupny")

        with pytest.raises(ScraperUnavailableError):
            await func()


class TestTransientHTTPError:
    """Test TransientHTTPError — HTTP 5xx, 429."""

    def setup_method(self):
        reset_retry_metrics()

    @pytest.mark.asyncio
    async def test_5xx_is_retried(self):
        calls = {'count': 0}

        @retry_async(source_type='ORSR', max_attempts=3, base_delay=0.01, jitter=0)
        async def func():
            calls['count'] += 1
            if calls['count'] < 2:
                raise TransientHTTPError("HTTP 503", status_code=503)
            return 'ok'

        result = await func()
        assert result == 'ok'
        assert calls['count'] == 2

    @pytest.mark.asyncio
    async def test_429_rate_limit_3x_delay(self):
        """429 → 3x delay (rate limited)."""
        import time
        timestamps = []

        @retry_async(source_type='ORSR', max_attempts=2, base_delay=0.05, jitter=0)
        async def func():
            timestamps.append(time.monotonic())
            raise TransientHTTPError("HTTP 429", status_code=429, rate_limited=True)

        with pytest.raises(ScraperUnavailableError):
            await func()

        delay = timestamps[1] - timestamps[0]
        # 0.05 * 3 = 0.15s (3x for rate limit)
        assert 0.14 <= delay <= 0.20, f"429 delay should be ~0.15s (3x), got {delay:.3f}s"


class TestOnRetryCallback:
    """Test on_retry callback — FS fresh-page pattern."""

    def setup_method(self):
        reset_retry_metrics()

    @pytest.mark.asyncio
    async def test_on_retry_called_between_attempts(self):
        state = {'page': 'page1', 'fresh': 0}

        async def _do():
            if state['page'] == 'page1':
                raise asyncio.TimeoutError("stuck")
            return state['page']

        async def _on_retry(attempt):
            state['fresh'] += 1
            state['page'] = f'page{state["fresh"] + 1}'

        result = await retry_async_call(
            _do, source_type='FS', max_attempts=3, base_delay=0.01, jitter=0, on_retry=_on_retry
        )
        assert result == 'page2'
        assert state['fresh'] == 1

    @pytest.mark.asyncio
    async def test_on_retry_failure_does_not_crash(self):
        """Ak on_retry callback zlyhá, retry pokračuje."""

        async def _do():
            raise asyncio.TimeoutError()

        async def _bad_callback(attempt):
            raise RuntimeError("callback crashed")

        with pytest.raises(ScraperUnavailableError):
            await retry_async_call(
                _do, source_type='FS', max_attempts=2, base_delay=0.01, jitter=0,
                on_retry=_bad_callback
            )


class TestRetryMetrics:
    """Test retry metrics counting."""

    def setup_method(self):
        reset_retry_metrics()

    @pytest.mark.asyncio
    async def test_metrics_recovery(self):
        @retry_async(source_type='METRIC_TEST', max_attempts=3, base_delay=0.01, jitter=0)
        async def func():
            raise asyncio.TimeoutError() if func._calls < 2 else 'ok'

        func._calls = 0

        async def _tracked():
            func._calls += 1
            if func._calls < 2:
                raise asyncio.TimeoutError()
            return 'ok'

        result = await retry_async(source_type='METRIC_TEST', max_attempts=3, base_delay=0.01, jitter=0)(_tracked)()
        assert result == 'ok'

        m = get_retry_metrics().get('METRIC_TEST', {})
        assert m.get('attempts') == 1
        assert m.get('retries') == 1
        assert m.get('recoveries') == 1
        assert m.get('exhausted') == 0

    @pytest.mark.asyncio
    async def test_metrics_exhausted(self):
        async def _fail():
            raise asyncio.TimeoutError()

        with pytest.raises(ScraperUnavailableError):
            await retry_async(source_type='METRIC_EXH', max_attempts=2, base_delay=0.01, jitter=0)(_fail)()

        m = get_retry_metrics().get('METRIC_EXH', {})
        assert m.get('exhausted') == 1
        assert m.get('recoveries') == 0

    @pytest.mark.asyncio
    async def test_metrics_permanent_skip(self):
        async def _perm():
            raise ValueError("bad")

        with pytest.raises(ValueError):
            await retry_async(source_type='METRIC_PERM', max_attempts=3, base_delay=0.01)(_perm)()

        m = get_retry_metrics().get('METRIC_PERM', {})
        assert m.get('permanent_skips') == 1
        assert m.get('retries') == 0

    def test_reset_metrics(self):
        _record = __import__('src.scrapers.base', fromlist=['_record_retry_metric'])._record_retry_metric
        _record('X', 'attempts')
        assert 'X' in get_retry_metrics()
        reset_retry_metrics()
        assert len(get_retry_metrics()) == 0

    def test_log_retry_metrics_no_crash(self):
        """log_retry_metrics nesmie crashnúť aj s prázdnymi metrics."""
        log_retry_metrics()  # no exception
