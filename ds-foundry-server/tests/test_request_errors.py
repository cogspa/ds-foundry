import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from google.genai.errors import ClientError, ServerError
from langchain_core.language_models.fake_chat_models import FakeListChatModel

from app import main
from app.request_errors import error_response, error_status

ITEM = {'key': 'fixture', 'category': 'icon', 'image': 'fixture'}


def sdk_error(code, status, message):
    cls = ServerError if code >= 500 else ClientError
    return cls(code, {'error': {'code': code, 'status': status, 'message': message}})


class FailingModel:
    def __init__(self, exc): self.exc = exc
    def invoke(self, messages): raise self.exc


@pytest.mark.parametrize('error,status,retryable', [
    (sdk_error(429, 'RESOURCE_EXHAUSTED', 'Requests per minute exceeded. Please retry in 32s.'), 429, True),
    (sdk_error(404, 'NOT_FOUND', 'models/example-model is not found'), 404, False),
    (sdk_error(403, 'PERMISSION_DENIED', 'API key cannot access this model'), 403, False),
    (sdk_error(503, 'UNAVAILABLE', 'Model capacity unavailable'), 503, True),
])
def test_provider_status_and_message_survive_proxy(monkeypatch, error, status, retryable):
    monkeypatch.setenv('GOOGLE_API_KEY', 'test-only-key')
    monkeypatch.setattr(main, 'get_chat_model', lambda *a: FailingModel(error))
    r = TestClient(main.app).post('/name', json={'provider':'gemini', 'model':'example-model', 'critic':False, 'items':[ITEM]})
    assert r.status_code == status
    e = r.json()['error']
    assert e['source'] == 'provider' and e['provider'] == 'gemini'
    assert e['model'] == 'example-model' and e['phase'] == 'naming'
    assert e['retryable'] is retryable
    assert str(error) == e['message']
    if status == 429:
        assert e['retryAfterSeconds'] == 32
        assert r.headers['retry-after'] == '32'


def test_critic_failure_preserves_phase_and_prevents_replay_of_completed_naming(monkeypatch):
    monkeypatch.setenv('GOOGLE_API_KEY', 'test-only-key')
    good = FakeListChatModel(responses=[json.dumps([{'i':0,'name':'cloud','kind':'icon','confidence':.95}])])
    monkeypatch.setattr(main, 'get_chat_model', lambda *a: good)
    monkeypatch.setattr(main, 'get_critic_model', lambda *a: FailingModel(sdk_error(503, 'UNAVAILABLE', 'Critic capacity unavailable')))
    r = TestClient(main.app).post('/name', json={'provider':'gemini','items':[ITEM]})
    assert r.status_code == 503
    e = r.json()['error']
    assert e['phase'] == 'critic' and e['model'] == main.CRITIC_MODELS['gemini']
    assert e['completedCalls'] == 1 and e['retryable'] is False


def test_local_failure_is_distinct_from_provider_failure(monkeypatch):
    monkeypatch.setenv('GOOGLE_API_KEY', 'test-only-key')
    monkeypatch.setattr(main, 'get_chat_model', lambda *a: object())
    def fail(*args): raise OSError('Cannot write naming cache: disk is full')
    monkeypatch.setattr(main, 'run_naming', fail)
    r = TestClient(main.app).post('/name', json={'provider':'gemini','critic':False,'items':[ITEM]})
    assert r.status_code == 500
    assert r.json()['error']['source'] == 'server'
    assert r.json()['error']['retryable'] is False
    assert 'disk is full' in r.json()['detail']


def test_configuration_error_redacts_both_env_and_request_keys(monkeypatch):
    monkeypatch.setenv('GOOGLE_API_KEY', 'private-env-secret')
    def fail(*args): raise ValueError('Unable to configure model key=private-request-secret using private-env-secret')
    monkeypatch.setattr(main, 'get_chat_model', fail)
    r = TestClient(main.app).post('/name', json={'provider':'gemini','api_key':'private-request-secret','critic':False,'items':[ITEM]})
    assert r.status_code == 400
    assert r.json()['error']['phase'] == 'model setup'
    assert 'private-request-secret' not in r.text and 'private-env-secret' not in r.text
    assert 'Unable to configure model' in r.text


def test_wrapped_sdk_status_is_recovered_and_unknown_errors_stay_unknown():
    assert error_status(ValueError('Error calling model: NOT_FOUND: missing model')) == 404
    assert error_status(ValueError('HTTP 429 rate exceeded')) == 429
    assert error_status(ValueError('Received 500 items from a model')) is None
    exc = RuntimeError('SDK wrapper')
    exc.__cause__ = sdk_error(403, 'PERMISSION_DENIED', 'Access denied')
    assert error_status(exc) == 403


def test_retry_header_is_forwarded():
    from app.request_errors import ProviderCallError
    exc = RuntimeError('Capacity unavailable')
    exc.status_code = 503
    exc.response = SimpleNamespace(headers={'Retry-After':'120'})
    response = error_response(ProviderCallError(exc, 'gemini', 'model', 'naming', 0))
    assert json.loads(response.body)['error']['retryAfterSeconds'] == 120


def test_wrapped_retry_after_and_http_date_are_preserved():
    from datetime import datetime, timedelta, timezone
    from email.utils import format_datetime
    from app.request_errors import retry_after
    inner = sdk_error(429, 'RESOURCE_EXHAUSTED', 'Quota exceeded')
    inner.response = SimpleNamespace(headers={'Retry-After': format_datetime(datetime.now(timezone.utc) + timedelta(seconds=120))})
    wrapper = RuntimeError('SDK invocation failed')
    wrapper.__cause__ = inner
    assert 119 <= retry_after(wrapper) <= 120


def test_project_storage_setup_failure_keeps_actual_message(monkeypatch):
    monkeypatch.setenv('GOOGLE_API_KEY', 'test-only-key')
    monkeypatch.setattr(main, 'get_chat_model', lambda *a: object())
    def fail(*args): raise PermissionError('Cannot open project cache: permission denied')
    monkeypatch.setattr(main, 'Cache', fail)
    r = TestClient(main.app).post('/name', json={'provider':'gemini','critic':False,'items':[ITEM]})
    assert r.status_code == 500
    assert r.json()['error']['retryable'] is False
    assert 'Cannot open project cache: permission denied' in r.json()['detail']


def test_unknown_provider_error_is_reported_without_inventing_a_busy_status():
    from app.request_errors import ProviderCallError
    r = error_response(ProviderCallError(RuntimeError('Unexpected SDK decode failure'), 'gemini', 'model', 'naming', 0))
    assert r.status_code == 502
    e = json.loads(r.body)['error']
    assert e['status'] is None and e['retryable'] is False
    assert e['message'] == 'Unexpected SDK decode failure'
