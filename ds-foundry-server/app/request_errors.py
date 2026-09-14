"""Keep provider diagnostics without exposing credentials or replaying partial work."""
import math
import os
import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

from fastapi.responses import JSONResponse

STATUS_NAMES = {
    'INVALID_ARGUMENT': 400, 'UNAUTHENTICATED': 401, 'PERMISSION_DENIED': 403,
    'NOT_FOUND': 404, 'RESOURCE_EXHAUSTED': 429, 'INTERNAL': 500,
    'UNAVAILABLE': 503, 'DEADLINE_EXCEEDED': 504,
}


def safe_message(value, secrets=()):
    text = str(value)
    for key in (*secrets, os.getenv('GOOGLE_API_KEY'), os.getenv('ANTHROPIC_API_KEY')):
        if key:
            text = text.replace(key, '[redacted]')
    text = re.sub(r'AIza[\w-]{20,}|sk-[\w-]{16,}', '[redacted]', text)
    text = re.sub(r'(?i)((?:api[_-]?key|x-goog-api-key|authorization|access_token)\s*[\"\']?\s*[:=]\s*[\"\']?)(?:Bearer\s+)?[^\s\"\'&,}]+', r'\1[redacted]', text)
    text = re.sub(r'data:image/[^;]+;base64,[A-Za-z0-9+/=]+', '[image omitted]', text)
    return text[:2000]


def error_status(exc):
    current, seen = exc, set()
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        for code in (getattr(current, 'status_code', None), getattr(current, 'code', None), getattr(getattr(current, 'response', None), 'status_code', None)):
            try:
                code = code() if callable(code) else code
                if isinstance(code, int) and 400 <= code <= 599:
                    return code
                if getattr(code, 'name', '') in STATUS_NAMES:
                    return STATUS_NAMES[code.name]
            except Exception:
                pass
        # Some SDK wrappers preserve only a status name or numeric code in text.
        text = str(current)
        for name, code in STATUS_NAMES.items():
            if re.search(r'\b' + name + r'\b', text):
                return code
        match = re.search(r'(?i)(?:^|HTTP\s+|status(?:_code| code)?[\s:=]+|Error code:\s*)([45]\d{2})\b', text)
        if match:
            return int(match[1])
        current = current.__cause__ or current.__context__
    return None


def retry_after(exc):
    current, seen = exc, set()
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        delay = _retry_after(current)
        if delay:
            return delay
        current = current.__cause__ or current.__context__
    return None


def _retry_after(exc):
    headers = getattr(getattr(exc, 'response', None), 'headers', {}) or {}
    value = headers.get('retry-after') or headers.get('Retry-After')
    try:
        seconds = float(value)
    except (ValueError, TypeError):
        try:
            seconds = (parsedate_to_datetime(value) - datetime.now(timezone.utc)).total_seconds()
        except (ValueError, TypeError, OverflowError):
            match = re.search(r'(?i)(?:retry in\s+|retryDelay[\"\']?\s*:\s*[\"\']?)(\d+(?:\.\d+)?)s', str(exc))
            seconds = float(match[1]) if match else 0
    return math.ceil(seconds) if math.isfinite(seconds) and seconds > 0 else None


class ProviderCallError(Exception):
    def __init__(self, cause, provider, model, phase, completed_calls):
        super().__init__(str(cause))
        self.cause, self.provider, self.model = cause, provider, model
        self.phase, self.completed_calls = phase, completed_calls


class ReportedModel:
    def __init__(self, model, provider, model_name, phase, completed):
        self.model, self.provider = model, provider
        self.model_name, self.phase, self.completed = model_name, phase, completed

    def invoke(self, messages):
        try:
            result = self.model.invoke(messages)
        except Exception as exc:
            raise ProviderCallError(exc, self.provider, self.model_name, self.phase, self.completed[0]) from exc
        self.completed[0] += 1
        return result


def error_response(exc, *, phase='naming service', secrets=(), default_status=500):
    provider_error = isinstance(exc, ProviderCallError)
    cause = exc.cause if provider_error else exc
    upstream = error_status(cause)
    status = upstream if provider_error and upstream else (502 if provider_error else default_status)
    completed = exc.completed_calls if provider_error else 0
    delay = retry_after(cause)
    # Unknown server faults, invalid requests and partial pipelines need attention,
    # not an automatic replay of already completed (potentially billable) calls.
    retryable = provider_error and upstream in (408, 429, 500, 502, 503, 504, 529) and not completed
    message = safe_message(cause, secrets) or type(cause).__name__
    detail = {'message': message, 'source': 'provider' if provider_error else 'server',
              'phase': exc.phase if provider_error else phase, 'retryable': retryable,
              'completedCalls': completed}
    if provider_error:
        detail.update(provider=exc.provider, model=exc.model, status=upstream)
    if delay:
        detail['retryAfterSeconds'] = delay
    headers = {'Retry-After': str(delay)} if delay else None
    return JSONResponse(status_code=status, content={'detail': message, 'error': detail}, headers=headers)
